import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { serializeMessageTemplate } from '@/lib/db/api-serialize'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/whatsapp/encryption'
import { submitMessageTemplate, resolveWabaId } from '@/lib/whatsapp/meta-api'
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components'
import { ensureImageHeaderHandle } from '@/lib/whatsapp/template-header-handle'
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize'

/**
 * Shared upsert payload builder — both the Meta-failure path and the
 * Meta-success path write nearly identical rows; dropping the shared
 * fields here means adding a column later only touches one spot.
 */
function buildUpsertRow(
  accountId: string,
  userId: string,
  payload: TemplatePayload,
  extras: {
    status: 'DRAFT' | string
    metaTemplateId: string | null
    submissionError: string | null
  },
) {
  return {
    // Account tenancy — required NOT NULL on message_templates as
    // of migration 017. Without this an INSERT throws on the
    // not-null constraint.
    account_id: accountId,
    // Original author — kept as audit only. The unique index is
    // still on (user_id, name, language) — see the upsert helper
    // for the cross-teammate dedup follow-up.
    user_id: userId,
    name: payload.name,
    category: payload.category,
    language: payload.language,
    header_type: payload.header_type ?? null,
    header_content: payload.header_content ?? null,
    header_media_url: payload.header_media_url ?? null,
    header_handle: payload.header_handle ?? null,
    body_text: payload.body_text,
    footer_text: payload.footer_text ?? null,
    buttons: payload.buttons ?? null,
    sample_values: payload.sample_values ?? null,
    status: extras.status,
    meta_template_id: extras.metaTemplateId,
    submission_error: extras.submissionError,
    // Clear stale rejection_reason whenever we re-submit; the
    // webhook will set it again if Meta still rejects.
    rejection_reason: extras.submissionError ? null : null,
    last_submitted_at: new Date().toISOString(),
  }
}

async function upsertTemplateRow(
  userId: string,
  accountId: string,
  row: ReturnType<typeof buildUpsertRow>,
) {
  const language = row.language ?? 'en_US'
  return prisma.messageTemplate.upsert({
    where: {
      userId_name_language: {
        userId,
        name: row.name,
        language,
      },
    },
    create: {
      userId,
      accountId,
      name: row.name,
      category: row.category,
      language,
      headerType: row.header_type ?? null,
      headerContent: row.header_content ?? null,
      headerMediaUrl: row.header_media_url ?? null,
      headerHandle: row.header_handle ?? null,
      bodyText: row.body_text,
      footerText: row.footer_text ?? null,
      buttons: row.buttons ?? undefined,
      sampleValues: (row.sample_values ?? undefined) as Prisma.InputJsonValue | undefined,
      status: row.status as import('@/generated/prisma/client').MessageTemplateStatus,
      metaTemplateId: row.meta_template_id,
      submissionError: row.submission_error,
      rejectionReason: null,
      lastSubmittedAt: new Date(),
    },
    update: {
      category: row.category,
      headerType: row.header_type ?? null,
      headerContent: row.header_content ?? null,
      headerMediaUrl: row.header_media_url ?? null,
      headerHandle: row.header_handle ?? null,
      bodyText: row.body_text,
      footerText: row.footer_text ?? null,
      buttons: row.buttons ?? undefined,
      sampleValues: (row.sample_values ?? undefined) as Prisma.InputJsonValue | undefined,
      status: row.status as import('@/generated/prisma/client').MessageTemplateStatus,
      metaTemplateId: row.meta_template_id,
      submissionError: row.submission_error,
      rejectionReason: null,
      lastSubmittedAt: new Date(),
    },
  })
}

/**
 * Submit a template to Meta for approval AND persist it locally.
 *
 * Auth → fetch whatsapp_config → validate → (DRY_RUN short-circuit) →
 * POST to Meta → upsert local row by (user_id, name, language) with
 * status, meta_template_id, sample_values, last_submitted_at.
 *
 * When WHATSAPP_TEMPLATES_DRY_RUN=true, we skip the network call and
 * insert a row with a synthetic `dry-run-<uuid>` meta_template_id so
 * CI / local dev can exercise the full UI without a real Meta App.
 *
 * On the Meta side this is a one-way trip — a row can only be
 * submitted; editing or deleting requires hsm_id and lives in PR 4.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const accountId = ctx.accountId
    const userId = ctx.userId

    let payload: TemplatePayload
    try {
      payload = (await request.json()) as TemplatePayload
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    if (payload.category === 'Authentication') {
      return NextResponse.json(
        {
          error:
            'AUTHENTICATION templates are not yet supported here — create them in Meta WhatsApp Manager and use "Sync from Meta".',
        },
        { status: 400 },
      )
    }

    try {
      validateTemplatePayload(payload)
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Validation failed.' },
        { status: 400 },
      )
    }

    const dryRun =
      process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' ||
      process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1'

    let metaTemplateId: string
    let metaStatus: string

    if (dryRun) {
      metaTemplateId = `dry-run-${crypto.randomUUID()}`
      metaStatus = 'PENDING'
    } else {
      const config = await prisma.whatsappConfig.findUnique({
        where: { accountId },
      })
      if (!config) {
        return NextResponse.json(
          {
            error:
              'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
          },
          { status: 400 },
        )
      }
      if (!config.phoneNumberId) {
        return NextResponse.json(
          {
            error:
              'Phone Number ID missing. Re-connect your WhatsApp account in Settings.',
          },
          { status: 400 },
        )
      }

      const accessToken = decrypt(config.accessToken)

      let wabaId: string
      try {
        wabaId = await resolveWabaId({
          phoneNumberId: config.phoneNumberId,
          accessToken,
          storedWabaId: config.wabaId,
        })
      } catch (e) {
        return NextResponse.json(
          {
            error:
              e instanceof Error
                ? e.message
                : 'Could not resolve WhatsApp Business Account ID.',
          },
          { status: 502 },
        )
      }

      if (wabaId !== config.wabaId) {
        await prisma.whatsappConfig.update({
          where: { accountId },
          data: { wabaId },
        })
      }

      // Image headers need a Resumable-Upload handle (Meta rejects a
      // plain URL at creation). Derive it from header_media_url before
      // building the payload. Surfaces a 400 with an actionable message
      // (missing META_APP_ID, unreachable URL, wrong type/size).
      try {
        await ensureImageHeaderHandle(payload, accessToken)
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'Header image upload failed.' },
          { status: 400 },
        )
      }

      const metaPayload = buildMetaTemplatePayload(payload)
      try {
        const meta = await submitMessageTemplate({
          wabaId,
          accessToken,
          payload: metaPayload,
        })
        metaTemplateId = meta.id
        metaStatus = meta.status
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Meta submit failed.'
        // Persist the failure so the user can retry; row stays DRAFT
        // until they fix and re-submit.
        await upsertTemplateRow(
          userId,
          accountId,
          buildUpsertRow(accountId, userId, payload, {
            status: 'DRAFT',
            metaTemplateId: null,
            submissionError: message,
          }),
        )
        const isRateLimit = /\b429\b/.test(message)
        return NextResponse.json(
          {
            error: isRateLimit
              ? 'Meta rate limit hit (100 template creates per hour). Try again later.'
              : message,
          },
          { status: isRateLimit ? 429 : 502 },
        )
      }
    }

    const row = await upsertTemplateRow(
      userId,
      accountId,
      buildUpsertRow(accountId, userId, payload, {
        status: normalizeStatus(metaStatus),
        metaTemplateId,
        submissionError: null,
      }),
    )

    return NextResponse.json({
      success: true,
      template: serializeMessageTemplate(row),
      dry_run: dryRun,
    })
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'UnauthorizedError' || error.name === 'ForbiddenError')
    ) {
      return toErrorResponse(error)
    }
    console.error('Error submitting template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to submit template.',
      },
      { status: 500 },
    )
  }
}
