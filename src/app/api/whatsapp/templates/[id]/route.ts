import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { serializeMessageTemplate } from '@/lib/db/api-serialize'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  deleteMessageTemplate,
  editMessageTemplate,
  resolveWabaId,
} from '@/lib/whatsapp/meta-api'
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components'
import { ensureImageHeaderHandle } from '@/lib/whatsapp/template-header-handle'

/**
 * Per-template lifecycle endpoint.
 *
 * PATCH  — edit an existing Meta-side template (and re-submit). Used
 *          by the "Edit" action on APPROVED rows and the "Resubmit"
 *          action on REJECTED / PAUSED rows. Meta replaces components
 *          wholesale on edit and bumps status back to PENDING.
 *
 * DELETE — remove the template on Meta (when meta_template_id is set,
 *          scoped to a single language variant via hsm_id) AND drop
 *          the local row. Local-only rows skip the Meta call.
 *
 * Initial submission (DRAFT → PENDING) lives at the sibling
 * /submit endpoint — keep this route narrowly about lifecycle of
 * already-submitted templates.
 */

const EDITABLE_STATUSES = new Set(['APPROVED', 'REJECTED', 'PAUSED'])

// uuid v4 plus the looser shape Postgres gen_random_uuid emits.
// We don't need exhaustive RFC parsing — just enough to reject
// "../etc/passwd"-style payloads before they hit Supabase.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isDryRun(): boolean {
  return (
    process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' ||
    process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1'
  )
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid template id.' },
        { status: 400 },
      )
    }
    const ctx = await getCurrentAccount()
    const accountId = ctx.accountId

    let payload: TemplatePayload
    try {
      payload = (await request.json()) as TemplatePayload
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    // RLS handles ownership, but we need the existing row to read
    // meta_template_id and status — fetch explicitly.
    const existing = await prisma.messageTemplate.findFirst({
      where: { id, accountId },
      select: {
        id: true,
        name: true,
        status: true,
        metaTemplateId: true,
        language: true,
      },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
    }

    if (!existing.metaTemplateId) {
      return NextResponse.json(
        {
          error:
            'This template was never submitted to Meta — use New Template to submit it instead.',
        },
        { status: 400 },
      )
    }

    if (!EDITABLE_STATUSES.has(existing.status)) {
      return NextResponse.json(
        {
          error: `Templates in status ${existing.status} cannot be edited. Allowed: APPROVED, REJECTED, PAUSED.`,
        },
        { status: 400 },
      )
    }

    if (payload.category === 'Authentication') {
      return NextResponse.json(
        {
          error:
            'AUTHENTICATION templates are not editable here — manage them in Meta WhatsApp Manager.',
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

    if (!isDryRun()) {
      const config = await prisma.whatsappConfig.findUnique({
        where: { accountId },
      })
      if (!config) {
        return NextResponse.json(
          { error: 'WhatsApp not configured.' },
          { status: 400 },
        )
      }
      const accessToken = decrypt(config.accessToken)

      // Image headers need a fresh Resumable-Upload handle on every edit
      // (Meta replaces components wholesale). Derive from header_media_url.
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
        await editMessageTemplate({
          metaTemplateId: existing.metaTemplateId,
          accessToken,
          components: metaPayload.components,
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Meta edit failed.'
        await prisma.messageTemplate.update({
          where: { id },
          data: {
            submissionError: message,
            lastSubmittedAt: new Date(),
          },
        })
        return NextResponse.json({ error: message }, { status: 502 })
      }
    }

    // Meta accepted the edit — status flips back to PENDING for review.
    const row = await prisma.messageTemplate.update({
      where: { id },
      data: {
        category: payload.category,
        headerType: payload.header_type ?? null,
        headerContent: payload.header_content ?? null,
        headerMediaUrl: payload.header_media_url ?? null,
        headerHandle: payload.header_handle ?? null,
        bodyText: payload.body_text,
        footerText: payload.footer_text ?? null,
        buttons: payload.buttons ?? undefined,
        sampleValues: (payload.sample_values ?? undefined) as Prisma.InputJsonValue | undefined,
        status: 'PENDING',
        submissionError: null,
        rejectionReason: null,
        lastSubmittedAt: new Date(),
      },
    })

    return NextResponse.json({
      success: true,
      template: serializeMessageTemplate(row),
      dry_run: isDryRun(),
    })
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'UnauthorizedError' || error.name === 'ForbiddenError')
    ) {
      return toErrorResponse(error)
    }
    console.error('Error editing template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to edit template.',
      },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid template id.' },
        { status: 400 },
      )
    }
    const ctx = await getCurrentAccount()
    const accountId = ctx.accountId

    const existing = await prisma.messageTemplate.findFirst({
      where: { id, accountId },
      select: { id: true, name: true, metaTemplateId: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
    }

    if (existing.metaTemplateId && !isDryRun()) {
      const config = await prisma.whatsappConfig.findUnique({
        where: { accountId },
      })
      if (!config?.phoneNumberId) {
        return NextResponse.json(
          { error: 'WhatsApp not configured — cannot delete on Meta.' },
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
      try {
        await deleteMessageTemplate({
          wabaId,
          accessToken,
          name: existing.name,
          metaTemplateId: existing.metaTemplateId,
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Meta delete failed.'
        return NextResponse.json({ error: message }, { status: 502 })
      }
    }

    await prisma.messageTemplate.delete({ where: { id } })

    return NextResponse.json({ success: true, dry_run: isDryRun() })
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'UnauthorizedError' || error.name === 'ForbiddenError')
    ) {
      return toErrorResponse(error)
    }
    console.error('Error deleting template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to delete template.',
      },
      { status: 500 },
    )
  }
}
