import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { serializeMessageTemplate } from '@/lib/db/api-serialize'
import { prisma } from '@/lib/prisma'
import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  type MediaKind,
} from '@/lib/whatsapp/meta-api'
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import type { MessageTemplate } from '@/types'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const accountId = ctx.accountId

    const limit = checkRateLimit(`send:${ctx.userId}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      conversation_id,
      message_type,
      content_text,
      media_url,
      filename,
      template_name,
      template_language,
      template_params,
      template_message_params,
      reply_to_message_id,
      draft_message_id,
    } = body

    if (!conversation_id) {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 }
      )
    }

    let effectiveMessageType = message_type
    let effectiveContentText = content_text
    let draftRow: { id: string; contentText: string | null } | null = null

    if (draft_message_id) {
      const draft = await prisma.message.findFirst({
        where: {
          id: draft_message_id,
          conversationId: conversation_id,
          status: 'draft',
          senderType: 'bot',
        },
        select: { id: true, contentText: true },
      })
      if (!draft?.contentText) {
        return NextResponse.json(
          { error: 'Draft message not found or empty' },
          { status: 404 }
        )
      }
      draftRow = draft
      effectiveMessageType = 'text'
      effectiveContentText = draft.contentText
    }

    if (!effectiveMessageType && !draft_message_id) {
      return NextResponse.json(
        { error: 'message_type is required' },
        { status: 400 }
      )
    }

    // Media kinds (image/video/document/audio) are sent to Meta via a
    // public URL the composer already uploaded to the chat-media bucket.
    const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const
    const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(
      effectiveMessageType,
    )

    // Reject anything outside the known set up front rather than letting
    // an unknown type fall through to the text path with empty content.
    const VALID_MESSAGE_TYPES = ['text', 'template', ...MEDIA_KINDS] as const
    if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(effectiveMessageType)) {
      return NextResponse.json(
        { error: `Unsupported message_type "${effectiveMessageType}"` },
        { status: 400 }
      )
    }

    if (effectiveMessageType === 'text' && !effectiveContentText) {
      return NextResponse.json(
        { error: 'content_text is required for text messages' },
        { status: 400 }
      )
    }

    if (effectiveMessageType === 'template' && !template_name) {
      return NextResponse.json(
        { error: 'template_name is required for template messages' },
        { status: 400 }
      )
    }

    if (isMediaKind && !media_url) {
      return NextResponse.json(
        { error: `media_url is required for ${effectiveMessageType} messages` },
        { status: 400 }
      )
    }

    // Meta caps media captions at 1024 chars; reject before the upload is
    // wasted at the Meta call. (Audio carries no caption — see meta-api.)
    if (
      isMediaKind &&
      effectiveMessageType !== 'audio' &&
      typeof effectiveContentText === 'string' &&
      effectiveContentText.length > 1024
    ) {
      return NextResponse.json(
        { error: 'Caption exceeds the 1024-character limit' },
        { status: 400 }
      )
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversation_id, accountId },
      include: { contact: true },
    })

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    const contact = conversation.contact
    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 }
      )
    }

    // Sanitize and validate phone
    const sanitizedPhone = sanitizePhoneForMeta(contact.phone)
    if (!isValidE164(sanitizedPhone)) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 }
      )
    }

    const config = await prisma.whatsappConfig.findUnique({
      where: { accountId },
    })

    if (!config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured. Please set up your WhatsApp integration first.' },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.accessToken)

    if (isLegacyFormat(config.accessToken)) {
      void prisma.whatsappConfig
        .update({
          where: { id: config.id },
          data: { accessToken: encrypt(accessToken) },
        })
        .catch((err) => {
          console.warn(
            '[whatsapp/send] access_token GCM upgrade failed:',
            err instanceof Error ? err.message : err,
          )
        })
    }

    // Resolve the reply target (if any) to its Meta message_id, which is
    // what `context.message_id` on the outgoing Meta payload needs. The
    // parent must belong to this same conversation — otherwise a caller
    // could quote messages they can't see by guessing UUIDs.
    let contextMessageId: string | undefined
    if (reply_to_message_id) {
      const parent = await prisma.message.findFirst({
        where: {
          id: reply_to_message_id,
          conversationId: conversation_id,
        },
        select: { messageId: true },
      })

      if (!parent) {
        return NextResponse.json(
          { error: 'reply_to_message_id not found in this conversation' },
          { status: 400 }
        )
      }
      if (!parent.messageId) {
        // Parent never reached Meta (still in 'sending' or 'failed') — we
        // can't quote it on WhatsApp. Send without context rather than
        // dropping the message entirely.
        console.warn(
          '[whatsapp/send] reply target has no Meta message_id; sending without context'
        )
      } else {
        contextMessageId = parent.messageId
      }
    }

    // Send via Meta API — retry with phone-number variants if Meta rejects
    // with "recipient not in allowed list" (common in sandbox / when a
    // number was registered with/without a trunk 0). If an alternate
    // format succeeds, we persist it back to the contact row so the
    // next send goes through on the first attempt.
    let waMessageId = ''
    let workingPhone = sanitizedPhone

    // For template sends, load the row so sendTemplateMessage can
    // build header + button components from the template definition.
    // Match on (user_id, name, language) — same triple the unique
    // index enforces — so multi-language templates work correctly.
    // Missing template falls through with `templateRow = null` and
    // the legacy body-only path runs.
    // Load the template row so sendTemplateMessage can build header
    // + button components from the definition. isMessageTemplate
    // guards against a malformed row (e.g. from a partial sync)
    // crashing the send-builder later in the stack.
    let templateRow: MessageTemplate | null = null
    if (effectiveMessageType === 'template' && template_name) {
      const raw = await prisma.messageTemplate.findFirst({
        where: {
          accountId,
          name: template_name,
          language: template_language || 'en_US',
        },
      })
      const data = raw ? serializeMessageTemplate(raw) : null
      if (data && !isMessageTemplate(data)) {
        return NextResponse.json(
          {
            error:
              'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
          },
          { status: 500 },
        )
      }
      templateRow = data ?? null
    }

    const attempt = async (phone: string): Promise<string> => {
      if (effectiveMessageType === 'template') {
        const result = await sendTemplateMessage({
          phoneNumberId: config.phoneNumberId,
          accessToken,
          to: phone,
          templateName: template_name,
          language: template_language || 'en_US',
          template: templateRow ?? undefined,
          messageParams: template_message_params ?? undefined,
          // Legacy body-only fallback — only consulted when
          // messageParams.body isn't set.
          params: template_params || [],
          contextMessageId,
        })
        return result.messageId
      }
      if (isMediaKind) {
        // content_text doubles as the caption (ignored for audio inside
        // sendMediaMessage). filename surfaces in the recipient's chat
        // for documents only.
        const result = await sendMediaMessage({
          phoneNumberId: config.phoneNumberId,
          accessToken,
          to: phone,
          kind: effectiveMessageType as MediaKind,
          link: media_url,
          caption: effectiveContentText || undefined,
          filename: filename || undefined,
          contextMessageId,
        })
        return result.messageId
      }
      const result = await sendTextMessage({
        phoneNumberId: config.phoneNumberId,
        accessToken,
        to: phone,
        text: effectiveContentText,
        contextMessageId,
      })
      return result.messageId
    }

    try {
      const variants = phoneVariants(sanitizedPhone)
      let lastError: unknown = null

      for (const variant of variants) {
        try {
          waMessageId = await attempt(variant)
          workingPhone = variant
          lastError = null
          break
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          // Only retry when the failure is specifically that the
          // recipient isn't in Meta's allowed list. Any other error
          // (bad token, invalid template, etc.) bubbles up immediately.
          if (!isRecipientNotAllowedError(message)) {
            throw err
          }
          lastError = err
          console.warn(`[whatsapp/send] variant "${variant}" rejected by Meta, trying next…`)
        }
      }

      if (lastError) throw lastError
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('Meta API send failed for all variants:', message)
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 502 }
      )
    }

    // If a non-original variant succeeded, update the contact so future
    // sends go straight through. sanitizePhoneForMeta on workingPhone
    // will yield workingPhone itself, so re-storing preserves it.
    if (workingPhone !== sanitizedPhone) {
      console.log(
        `[whatsapp/send] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`
      )
      await prisma.contact.update({
        where: { id: contact.id },
        data: { phone: workingPhone },
      })
    }

    // Insert message into DB — field names MUST match the messages schema
    // (see supabase/migrations/001_initial_schema.sql):
    //   conversation_id, sender_type, content_type, content_text,
    //   media_url, template_name, message_id, status, created_at
    const messageRecord = draftRow
      ? await prisma.message.update({
          where: { id: draftRow.id },
          data: {
            senderType: 'bot',
            contentType: effectiveMessageType,
            contentText: effectiveContentText || null,
            mediaUrl: media_url || null,
            templateName: template_name || null,
            messageId: waMessageId,
            status: 'sent',
            replyToMessageId: reply_to_message_id || null,
          },
        })
      : await prisma.message.create({
          data: {
            conversationId: conversation_id,
            senderType: 'agent',
            contentType: effectiveMessageType,
            contentText: effectiveContentText || null,
            mediaUrl: media_url || null,
            templateName: template_name || null,
            messageId: waMessageId,
            status: 'sent',
            replyToMessageId: reply_to_message_id || null,
          },
        })

    await prisma.conversation.update({
      where: { id: conversation_id },
      data: {
        lastMessageText:
          effectiveContentText || `[${effectiveMessageType}]`,
        lastMessageAt: new Date(),
      },
    })

    // Pause any active Flow run for this contact — the agent stepping
    // in is the strongest "yield, human is here" signal. See PR #2
    // plan for why we pause (not end): preserves diagnostic state +
    // lets the agent or the 24h timeout sweep cleanly resolve the
    // run later. For accounts with no active runs the UPDATE matches
    // zero rows — cheap and harmless.
    try {
      await prisma.flowRun.updateMany({
        where: {
          accountId,
          contactId: contact.id,
          status: 'active',
        },
        data: {
          status: 'paused_by_agent',
          endedAt: new Date(),
          endReason: 'agent_replied',
        },
      })
    } catch (err) {
      console.error(
        '[flows] pause-on-agent-send threw:',
        err instanceof Error ? err.message : err,
      )
    }

    return NextResponse.json({
      success: true,
      message_id: messageRecord.id,
      whatsapp_message_id: waMessageId,
    })
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'UnauthorizedError' || error.name === 'ForbiddenError')
    ) {
      return toErrorResponse(error)
    }
    console.error('Error in WhatsApp send POST:', error)
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    )
  }
}
