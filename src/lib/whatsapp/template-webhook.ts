import { prisma } from '@/lib/prisma'
import { normalizeStatus } from './template-status-normalize'
import type { MessageTemplateQualityScore, MessageTemplateStatus } from '@/generated/prisma/client'

const TEMPLATE_WEBHOOK_FIELDS = new Set([
  'message_template_status_update',
  'message_template_quality_update',
  'message_template_components_update',
])

export function isTemplateWebhookField(field: string): boolean {
  return TEMPLATE_WEBHOOK_FIELDS.has(field)
}

interface TemplateStatusUpdateValue {
  event?: string
  message_template_id?: string | number
  message_template_name?: string
  message_template_language?: string
  reason?: string
}

interface TemplateQualityUpdateValue {
  message_template_id?: string | number
  message_template_name?: string
  message_template_language?: string
  previous_quality_score?: string
  new_quality_score?: string
}

interface TemplateComponentsUpdateValue {
  message_template_id?: string | number
  message_template_name?: string
  message_template_language?: string
}

export interface TemplateWebhookChange {
  field: string
  value: unknown
}

/**
 * Dispatch a single change record to the matching handler. Returns
 * silently on unrecognised fields — the caller already pre-filtered
 * via isTemplateWebhookField, but treat unknown values as no-ops
 * defensively in case Meta adds new template fields later.
 */
export async function handleTemplateWebhookChange(
  change: TemplateWebhookChange,
): Promise<void> {
  switch (change.field) {
    case 'message_template_status_update':
      await handleStatusUpdate(
        change.value as TemplateStatusUpdateValue,
      )
      return
    case 'message_template_quality_update':
      await handleQualityUpdate(
        change.value as TemplateQualityUpdateValue,
      )
      return
    case 'message_template_components_update':
      handleComponentsUpdate(
        change.value as TemplateComponentsUpdateValue,
      )
      return
  }
}

async function handleStatusUpdate(
  value: TemplateStatusUpdateValue,
): Promise<void> {
  const metaTemplateId =
    value.message_template_id !== undefined
      ? String(value.message_template_id)
      : null
  if (!metaTemplateId || !value.event) {
    console.warn(
      '[template-webhook] status update missing message_template_id or event:',
      value,
    )
    return
  }

  const status = normalizeStatus(value.event) as MessageTemplateStatus

  // Persist the rejection reason on REJECTED — that's the only event
  // where Meta sends a human-readable explanation. Clear it on any
  // other status flip so the UI doesn't show a stale REJECTED banner
  // after Meta re-approves a resubmitted template.
  const update = {
    status,
    rejectionReason:
      status === 'REJECTED' ? value.reason ?? 'Rejected by Meta' : null,
    submissionError: null,
  }

  try {
    const result = await prisma.messageTemplate.updateMany({
      where: { metaTemplateId },
      data: update,
    })

    if (result.count === 0) {
      console.warn(
        '[template-webhook] status update received for unknown template:',
        metaTemplateId,
        value.message_template_name,
      )
      return
    }
    if (result.count > 1) {
      console.warn(
        `[template-webhook] status update matched ${result.count} rows for meta_template_id ${metaTemplateId} — investigate.`,
      )
    }
  } catch (err) {
    console.error(
      '[template-webhook] status update failed for meta_template_id',
      metaTemplateId,
      err instanceof Error ? err.message : err,
    )
  }
}

async function handleQualityUpdate(
  value: TemplateQualityUpdateValue,
): Promise<void> {
  const metaTemplateId =
    value.message_template_id !== undefined
      ? String(value.message_template_id)
      : null
  if (!metaTemplateId) {
    console.warn(
      '[template-webhook] quality update missing message_template_id:',
      value,
    )
    return
  }

  const raw = value.new_quality_score
  const score: MessageTemplateQualityScore | null =
    raw && ['GREEN', 'YELLOW', 'RED'].includes(raw.toUpperCase())
      ? (raw.toUpperCase() as MessageTemplateQualityScore)
      : null

  try {
    await prisma.messageTemplate.updateMany({
      where: { metaTemplateId },
      data: { qualityScore: score },
    })
  } catch (err) {
    console.error(
      '[template-webhook] quality update failed for meta_template_id',
      metaTemplateId,
      err instanceof Error ? err.message : err,
    )
  }
}

/**
 * Meta auto-modified the template (typically a category reclassification
 * — e.g. Marketing → Utility after content review).
 *
 * For v1 we just log and let the user pull updated components via the
 * existing "Sync from Meta" button — persisting Meta's modified
 * components without showing the user would silently change what they
 * thought they submitted. A future PR could mark the row with a
 * "Meta modified this template" banner.
 */
function handleComponentsUpdate(value: TemplateComponentsUpdateValue): void {
  console.info(
    '[template-webhook] components updated by Meta for template',
    value.message_template_id,
    value.message_template_name,
    '— run "Sync from Meta" in Settings to pull the new components.',
  )
}
