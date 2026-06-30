import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  listMessageTemplates,
  resolveWabaId,
  type MetaTemplateListItem,
} from '@/lib/whatsapp/meta-api'
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize'
import type { TemplateButton, TemplateSampleValues } from '@/types'

/**
 * Sync message templates from Meta → local message_templates table.
 *
 * The local catalog stores Meta's status enum verbatim (APPROVED /
 * PENDING / REJECTED / PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION)
 * so the edit / resubmit / delete flows can distinguish recoverable
 * states (PAUSED) from terminal ones (DISABLED) and so webhook events
 * land 1:1 without a translation table.
 *
 * Locally-created templates (no Meta counterpart) are NOT deleted —
 * they remain visible so the user can notice drift and clean up.
 */

interface MetaButton {
  type: string
  text: string
  url?: string
  phone_number?: string
  example?: string[] | string
}

interface MetaTemplateComponent {
  type: string
  text?: string
  format?: string
  buttons?: MetaButton[]
  example?: {
    header_text?: string[]
    header_handle?: string[]
    body_text?: string[][]
  }
}

function normalizeCategory(
  meta: string,
): 'Marketing' | 'Utility' | 'Authentication' {
  const upper = meta.toUpperCase()
  if (upper === 'UTILITY') return 'Utility'
  if (upper === 'AUTHENTICATION') return 'Authentication'
  return 'Marketing'
}

function normalizeQualityScore(
  raw: MetaTemplateListItem['quality_score'],
): 'GREEN' | 'YELLOW' | 'RED' | null {
  const score =
    typeof raw === 'string' ? raw : raw?.score ? String(raw.score) : null
  if (!score) return null
  const upper = score.toUpperCase()
  return upper === 'GREEN' || upper === 'YELLOW' || upper === 'RED'
    ? (upper as 'GREEN' | 'YELLOW' | 'RED')
    : null
}

function parseButtons(metaButtons: MetaButton[] | undefined): TemplateButton[] {
  if (!metaButtons?.length) return []
  const out: TemplateButton[] = []
  for (const b of metaButtons) {
    switch (b.type?.toUpperCase()) {
      case 'QUICK_REPLY':
        out.push({ type: 'QUICK_REPLY', text: b.text })
        break
      case 'URL':
        out.push({
          type: 'URL',
          text: b.text,
          url: b.url ?? '',
          example: Array.isArray(b.example) ? b.example[0] : b.example,
        })
        break
      case 'PHONE_NUMBER':
        out.push({
          type: 'PHONE_NUMBER',
          text: b.text,
          phone_number: b.phone_number ?? '',
        })
        break
      case 'COPY_CODE':
        out.push({
          type: 'COPY_CODE',
          text: b.text,
          example: Array.isArray(b.example) ? b.example[0] ?? '' : b.example ?? '',
        })
        break
      // OTP, FLOW, etc — out of scope for v1; drop silently.
    }
  }
  return out
}

function extractSampleValues(
  body: MetaTemplateComponent | undefined,
  header: MetaTemplateComponent | undefined,
): TemplateSampleValues | null {
  // Meta returns body_text as a 2D array — one row per example set.
  // We take the first row (most templates have exactly one).
  const bodySample = body?.example?.body_text?.[0]
  const headerSample = header?.example?.header_text
  if (!bodySample?.length && !headerSample?.length) return null
  const sv: TemplateSampleValues = {}
  if (bodySample?.length) sv.body = bodySample
  if (headerSample?.length) sv.header = headerSample
  return sv
}

export async function POST() {
  try {
    const ctx = await getCurrentAccount()
    const accountId = ctx.accountId
    const userId = ctx.userId

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
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not resolve WABA ID'
      return NextResponse.json({ error: message }, { status: 502 })
    }

    if (wabaId !== config.wabaId) {
      await prisma.whatsappConfig.update({
        where: { accountId },
        data: { wabaId },
      })
    }

    let metaTemplates: MetaTemplateListItem[] = []
    let truncated = false
    try {
      const listed = await listMessageTemplates({ wabaId, accessToken })
      metaTemplates = listed.templates
      truncated = listed.truncated
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Meta template sync failed'
      return NextResponse.json({ error: message }, { status: 502 })
    }

    let inserted = 0
    let updated = 0
    const errors: { name: string; language: string; message: string }[] = []

    for (const t of metaTemplates) {
      const body = (t.components ?? []).find((c) => c.type === 'BODY')
      const header = (t.components ?? []).find((c) => c.type === 'HEADER')
      const footer = (t.components ?? []).find((c) => c.type === 'FOOTER')
      const buttons = (t.components ?? []).find((c) => c.type === 'BUTTONS')

      const parsedButtons = parseButtons(buttons?.buttons)
      const sampleValues = extractSampleValues(body, header)

      const headerFormat = header?.format?.toUpperCase()
      const headerType =
        headerFormat === 'TEXT' ||
        headerFormat === 'IMAGE' ||
        headerFormat === 'VIDEO' ||
        headerFormat === 'DOCUMENT'
          ? headerFormat.toLowerCase()
          : null

      const rowData = {
        accountId,
        userId,
        name: t.name,
        category: normalizeCategory(t.category),
        language: t.language,
        headerType: headerType as import('@/generated/prisma/client').MessageTemplateHeaderType | null,
        headerContent: header?.text ?? null,
        headerHandle: header?.example?.header_handle?.[0] ?? null,
        bodyText: body?.text ?? '',
        footerText: footer?.text ?? null,
        buttons: parsedButtons.length ? parsedButtons : undefined,
        sampleValues: (sampleValues ?? undefined) as Prisma.InputJsonValue | undefined,
        status: normalizeStatus(t.status) as import('@/generated/prisma/client').MessageTemplateStatus,
        metaTemplateId: t.id,
        qualityScore: normalizeQualityScore(t.quality_score),
      }

      const existing = await prisma.messageTemplate.findFirst({
        where: {
          accountId,
          name: t.name,
          language: t.language,
        },
        select: { id: true },
      })

      try {
        if (existing?.id) {
          await prisma.messageTemplate.update({
            where: { id: existing.id },
            data: rowData,
          })
          updated++
        } else {
          await prisma.messageTemplate.create({ data: rowData })
          inserted++
        }
      } catch (err) {
        errors.push({
          name: t.name,
          language: t.language,
          message: err instanceof Error ? err.message : 'upsert failed',
        })
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      total: metaTemplates.length,
      inserted,
      updated,
      errors,
      truncated,
    })
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'UnauthorizedError' || error.name === 'ForbiddenError')
    ) {
      return toErrorResponse(error)
    }
    console.error('Error syncing WhatsApp templates:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to sync templates',
      },
      { status: 500 },
    )
  }
}
