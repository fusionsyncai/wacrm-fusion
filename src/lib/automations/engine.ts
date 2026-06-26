import type {
  Automation,
  AutomationLogStepResult,
  AutomationStep,
  AutomationTriggerType,
  ConditionStepConfig,
  KeywordMatchTriggerConfig,
  SendMessageStepConfig,
  SendTemplateStepConfig,
  SendWebhookStepConfig,
  TagStepConfig,
  UpdateContactFieldStepConfig,
  WaitStepConfig,
  CreateDealStepConfig,
  AssignConversationStepConfig,
} from '@/types'
import type { Automation as PrismaAutomation, AutomationStep as PrismaAutomationStep } from '@/generated/prisma/client'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/prisma'
import { engineSendText, engineSendTemplate } from './meta-send'

function toAutomation(row: PrismaAutomation): Automation {
  return {
    id: row.id,
    account_id: row.accountId,
    user_id: row.userId,
    name: row.name,
    description: row.description ?? undefined,
    trigger_type: row.triggerType as Automation['trigger_type'],
    trigger_config: row.triggerConfig as Automation['trigger_config'],
    is_active: row.isActive,
    execution_count: row.executionCount,
    last_executed_at: row.lastExecutedAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

function toAutomationStep(row: PrismaAutomationStep): AutomationStep {
  return {
    id: row.id,
    automation_id: row.automationId,
    parent_step_id: row.parentStepId,
    branch: row.branch,
    step_type: row.stepType as AutomationStep['step_type'],
    step_config: row.stepConfig as AutomationStep['step_config'],
    position: row.position,
    created_at: row.createdAt.toISOString(),
  }
}

// ------------------------------------------------------------
// Public API
// ------------------------------------------------------------

export interface AutomationContext {
  /** Raw message text, for keyword_match + message_content conditions. */
  message_text?: string
  /** Conversation the event belongs to, if any. */
  conversation_id?: string
  /** Arbitrary variables accumulated during execution. */
  vars?: Record<string, unknown>
  /** The tag id that was added, for tag_added trigger. */
  tag_id?: string
  /** Agent the conversation was assigned to, for conversation_assigned. */
  agent_id?: string
}

export interface DispatchInput {
  /** Account-level tenancy key. Drives the lookup of which active
   *  automations to fire — `automations.account_id` is the tenant
   *  isolation after migration 017. Replaces the previous `userId`
   *  field; the per-automation user_id is read off each row when
   *  needed (sender identity for outbound messages, log audit). */
  accountId: string
  triggerType: AutomationTriggerType
  contactId?: string | null
  context?: AutomationContext
}

/**
 * Fire all active automations matching the given trigger for an
 * account.
 *
 * Must never throw — callers use fire-and-forget from the webhook.
 * All errors are caught and logged; per-automation failures are
 * recorded into automation_logs with status='failed'.
 */
export async function runAutomationsForTrigger(input: DispatchInput): Promise<void> {
  try {
    if (input.contactId) {
      const owned = await prisma.contact.findFirst({
        where: { id: input.contactId, accountId: input.accountId },
        select: { id: true },
      })
      if (!owned) {
        console.warn('[automations] contact not in account, refusing dispatch', input.contactId)
        return
      }
    }

    const automations = (
      await prisma.automation.findMany({
        where: {
          accountId: input.accountId,
          triggerType: input.triggerType,
          isActive: true,
        },
      })
    ).map(toAutomation)

    if (automations.length === 0) return

    for (const automation of automations as Automation[]) {
      if (!triggerMatches(automation, input.context)) continue
      try {
        await executeAutomation(automation, input)
      } catch (err) {
        console.error('[automations] execute failed:', automation.id, err)
      }
    }
  } catch (err) {
    console.error('[automations] dispatch failed:', err)
  }
}

/**
 * Resume a run that was parked at a wait step. Called from the cron
 * endpoint after it grabs a due `automation_pending_executions` row.
 */
export async function resumePendingExecution(pending: {
  id: string
  automation_id: string
  /** Audit-only; the automation row carries account_id for tenancy. */
  user_id: string
  /** Account-scoped lookups read from the automation row, so this
   *  field is just here to mirror the row shape and keep the cron's
   *  pass-through self-documenting. */
  account_id: string
  contact_id: string | null
  log_id: string | null
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
  next_step_position: number
  context: AutomationContext
}): Promise<void> {
  const automationRow = await prisma.automation.findUnique({
    where: { id: pending.automation_id },
  })

  if (!automationRow) {
    console.error('[automations] resume: missing automation', pending.automation_id)
    await markPending(pending.id, 'failed')
    return
  }

  const automation = toAutomation(automationRow)

  try {
    await executeStepsFrom({
      automation,
      contactId: pending.contact_id,
      context: pending.context ?? {},
      parentStepId: pending.parent_step_id,
      branch: pending.branch,
      startPosition: pending.next_step_position,
      logId: pending.log_id,
      triggerEvent: 'resumed_wait',
    })
    await markPending(pending.id, 'done')
  } catch (err) {
    console.error('[automations] resume failed:', err)
    await markPending(pending.id, 'failed')
  }
}

// ------------------------------------------------------------
// Internal execution
// ------------------------------------------------------------

async function executeAutomation(automation: Automation, input: DispatchInput) {
  const log = await prisma.automationLog.create({
    data: {
      automationId: automation.id,
      accountId: automation.account_id,
      userId: automation.user_id,
      contactId: input.contactId ?? null,
      triggerEvent: input.triggerType,
      stepsExecuted: [],
      status: 'success',
    },
  })

  await executeStepsFrom({
    automation,
    contactId: input.contactId ?? null,
    context: input.context ?? {},
    parentStepId: null,
    branch: null,
    startPosition: 0,
    logId: log.id,
    triggerEvent: input.triggerType,
  })

  try {
    await prisma.$executeRaw`SELECT increment_automation_execution_count(${automation.id}::uuid)`
  } catch (rpcErr) {
    console.error('[automations] increment counter failed:', rpcErr)
  }
}

interface ExecuteArgs {
  automation: Automation
  contactId: string | null
  context: AutomationContext
  parentStepId: string | null
  branch: 'yes' | 'no' | null
  startPosition: number
  logId: string | null
  triggerEvent: string
}

async function executeStepsFrom(args: ExecuteArgs): Promise<void> {
  const steps = (
    await prisma.automationStep.findMany({
      where: {
        automationId: args.automation.id,
        position: { gte: args.startPosition },
        ...(args.parentStepId === null
          ? { parentStepId: null }
          : { parentStepId: args.parentStepId, branch: args.branch ?? 'yes' }),
      },
      orderBy: { position: 'asc' },
    })
  ).map(toAutomationStep)

  if (steps.length === 0) {
    if (args.parentStepId === null && args.logId) {
      await finalizeLog(args.logId, 'success', null)
    }
    return
  }

  const results: AutomationLogStepResult[] = []
  let status: 'success' | 'partial' | 'failed' = 'success'
  let errorMessage: string | null = null

  for (const step of steps as AutomationStep[]) {
    if (step.step_type === 'wait') {
      const cfg = step.step_config as WaitStepConfig
      const ms = waitMs(cfg)
      await prisma.automationPendingExecution.create({
        data: {
          automationId: args.automation.id,
          accountId: args.automation.account_id,
          userId: args.automation.user_id,
          contactId: args.contactId,
          logId: args.logId,
          parentStepId: args.parentStepId,
          branch: args.branch,
          nextStepPosition: step.position + 1,
          context: args.context as Prisma.InputJsonValue,
          runAt: new Date(Date.now() + ms),
          status: 'pending',
        },
      })
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail: `waiting ${cfg.amount} ${cfg.unit}`,
      })
      status = 'partial'
      await appendResults(args.logId, results, status, errorMessage)
      return
    }

    try {
      if (step.step_type === 'condition') {
        const cfg = step.step_config as ConditionStepConfig
        const taken = await evaluateCondition(cfg, args)
        results.push({
          step_id: step.id,
          step_type: 'condition',
          status: 'success',
          detail: `branch=${taken ? 'yes' : 'no'}`,
        })
        await executeStepsFrom({
          ...args,
          parentStepId: step.id,
          branch: taken ? 'yes' : 'no',
          startPosition: 0,
          logId: args.logId,
        })
        continue
      }

      const detail = await runStep(step, args)
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'success',
        detail,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({
        step_id: step.id,
        step_type: step.step_type,
        status: 'failed',
        detail: msg,
      })
      status = 'failed'
      errorMessage = msg
      break
    }
  }

  if (args.parentStepId === null) {
    await appendResults(args.logId, results, status, errorMessage)
  } else {
    await appendResults(args.logId, results, null, errorMessage)
  }
}

async function runStep(step: AutomationStep, args: ExecuteArgs): Promise<string> {
  switch (step.step_type) {
    case 'send_message': {
      const cfg = step.step_config as SendMessageStepConfig
      if (!args.contactId) throw new Error('send_message needs a contact')
      const text = interpolate(cfg.text, args)
      if (!text.trim()) throw new Error('send_message has empty text')
      const conversationId = await resolveConversationId(args)
      const { whatsapp_message_id } = await engineSendText({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        text,
      })
      return `sent via Meta (${whatsapp_message_id})`
    }

    case 'send_template': {
      const cfg = step.step_config as SendTemplateStepConfig
      if (!args.contactId) throw new Error('send_template needs a contact')
      if (!cfg.template_name) throw new Error('send_template needs template_name')
      const conversationId = await resolveConversationId(args)
      const params = cfg.variables
        ? Object.keys(cfg.variables)
            .sort((a, b) => {
              const na = Number(a)
              const nb = Number(b)
              const aNum = Number.isFinite(na)
              const bNum = Number.isFinite(nb)
              if (aNum && bNum) return na - nb
              if (aNum) return -1
              if (bNum) return 1
              return a.localeCompare(b)
            })
            .map((k) => String(cfg.variables![k]))
        : []
      const { whatsapp_message_id } = await engineSendTemplate({
        accountId: args.automation.account_id,
        userId: args.automation.user_id,
        conversationId,
        contactId: args.contactId,
        templateName: cfg.template_name,
        language: cfg.language,
        params,
      })
      return `template sent via Meta (${whatsapp_message_id})`
    }

    case 'add_tag': {
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('add_tag needs contact + tag_id')
      await prisma.contactTag.upsert({
        where: {
          contactId_tagId: { contactId: args.contactId, tagId: cfg.tag_id },
        },
        create: { contactId: args.contactId, tagId: cfg.tag_id },
        update: {},
      })
      return `tag ${cfg.tag_id} added`
    }

    case 'remove_tag': {
      const cfg = step.step_config as TagStepConfig
      if (!args.contactId || !cfg.tag_id) throw new Error('remove_tag needs contact + tag_id')
      await prisma.contactTag.deleteMany({
        where: { contactId: args.contactId, tagId: cfg.tag_id },
      })
      return `tag ${cfg.tag_id} removed`
    }

    case 'assign_conversation': {
      const cfg = step.step_config as AssignConversationStepConfig
      if (!args.contactId) throw new Error('assign_conversation needs a contact')
      let agentId = cfg.agent_id
      if (cfg.mode === 'round_robin') {
        const profile = await prisma.profile.findFirst({
          where: { accountId: args.automation.account_id },
          select: { userId: true },
        })
        agentId = profile?.userId
      }
      if (!agentId) return 'no agent resolved'
      await prisma.conversation.updateMany({
        where: {
          accountId: args.automation.account_id,
          contactId: args.contactId,
        },
        data: { assignedAgentId: agentId },
      })
      return `assigned to ${agentId}`
    }

    case 'update_contact_field': {
      const cfg = step.step_config as UpdateContactFieldStepConfig
      if (!args.contactId) throw new Error('update_contact_field needs a contact')
      const value = interpolate(cfg.value, args)

      if (cfg.field.startsWith('custom:')) {
        const customFieldId = cfg.field.slice('custom:'.length)
        if (!customFieldId) {
          return `field ${cfg.field} not writable from automations`
        }
        const field = await prisma.customField.findFirst({
          where: { id: customFieldId, accountId: args.automation.account_id },
          select: { id: true },
        })
        if (!field) {
          return `field ${cfg.field} not writable from automations`
        }
        await prisma.contactCustomValue.upsert({
          where: {
            contactId_customFieldId: {
              contactId: args.contactId,
              customFieldId,
            },
          },
          create: {
            contactId: args.contactId,
            customFieldId,
            value,
          },
          update: { value },
        })
        return `custom field updated`
      }

      const allowed = new Set(['name', 'email', 'company'])
      if (!allowed.has(cfg.field)) {
        return `field ${cfg.field} not writable from automations`
      }
      await prisma.contact.updateMany({
        where: {
          id: args.contactId,
          accountId: args.automation.account_id,
        },
        data: { [cfg.field]: value },
      })
      return `${cfg.field} updated`
    }

    case 'create_deal': {
      const cfg = step.step_config as CreateDealStepConfig
      if (!cfg.pipeline_id || !cfg.stage_id) throw new Error('create_deal needs pipeline + stage')
      const acct = await prisma.account.findUnique({
        where: { id: args.automation.account_id },
        select: { defaultCurrency: true },
      })
      await prisma.deal.create({
        data: {
          accountId: args.automation.account_id,
          userId: args.automation.user_id,
          pipelineId: cfg.pipeline_id,
          stageId: cfg.stage_id,
          contactId: args.contactId,
          title: interpolate(cfg.title, args),
          value: cfg.value ?? 0,
          currency: acct?.defaultCurrency ?? 'USD',
          status: 'open',
        },
      })
      return 'deal created'
    }

    case 'send_webhook': {
      const cfg = step.step_config as SendWebhookStepConfig
      if (!cfg.url) throw new Error('send_webhook needs url')
      const body = cfg.body_template ? interpolate(cfg.body_template, args) : JSON.stringify(args.context)
      const res = await fetch(cfg.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.headers ?? {}) },
        body,
      })
      if (!res.ok) throw new Error(`webhook returned ${res.status}`)
      return `webhook ${res.status}`
    }

    case 'close_conversation': {
      if (!args.contactId) throw new Error('close_conversation needs a contact')
      await prisma.conversation.updateMany({
        where: {
          accountId: args.automation.account_id,
          contactId: args.contactId,
        },
        data: { status: 'closed' },
      })
      return 'conversation closed'
    }

    default:
      return `unknown step: ${step.step_type}`
  }
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

async function resolveConversationId(args: ExecuteArgs): Promise<string> {
  const fromCtx = args.context.conversation_id
  if (fromCtx) return fromCtx
  if (!args.contactId) throw new Error('cannot resolve conversation: no contact')
  const data = await prisma.conversation.findFirst({
    where: {
      accountId: args.automation.account_id,
      contactId: args.contactId,
    },
    select: { id: true },
  })
  if (!data?.id) throw new Error('no conversation for contact')
  return data.id
}

function triggerMatches(automation: Automation, ctx: AutomationContext | undefined): boolean {
  if (automation.trigger_type !== 'keyword_match') return true
  const cfg = automation.trigger_config as KeywordMatchTriggerConfig
  if (!cfg?.keywords || cfg.keywords.length === 0) return false
  const text = (ctx?.message_text ?? '').toString()
  if (!text) return false
  const haystack = cfg.case_sensitive ? text : text.toLowerCase()
  return cfg.keywords.some((raw) => {
    const k = cfg.case_sensitive ? raw : raw.toLowerCase()
    return cfg.match_type === 'exact' ? haystack === k : haystack.includes(k)
  })
}

async function evaluateCondition(cfg: ConditionStepConfig, args: ExecuteArgs): Promise<boolean> {
  switch (cfg.subject) {
    case 'tag_presence': {
      if (!args.contactId || !cfg.operand) return false
      const count = await prisma.contactTag.count({
        where: { contactId: args.contactId, tagId: cfg.operand },
      })
      return count > 0
    }
    case 'contact_field': {
      if (!args.contactId || !cfg.operand) return false
      const allowed = new Set(['name', 'email', 'phone', 'company'])
      if (!allowed.has(cfg.operand)) return false
      const data = await prisma.contact.findFirst({
        where: { id: args.contactId, accountId: args.automation.account_id },
        select: {
          name: true,
          email: true,
          phone: true,
          company: true,
        },
      })
      const v = data?.[cfg.operand as keyof typeof data]
      return v != null && String(v) === String(cfg.value ?? '')
    }
    case 'message_content': {
      const text = (args.context.message_text ?? '').toString()
      return text.toLowerCase().includes((cfg.value ?? '').toLowerCase())
    }
    case 'time_of_day': {
      const [from, to] = (cfg.operand ?? '').split('-')
      if (!from || !to) return false
      const now = new Date()
      const mins = now.getHours() * 60 + now.getMinutes()
      const parse = (s: string) => {
        const [h, m] = s.split(':').map(Number)
        return (h || 0) * 60 + (m || 0)
      }
      const f = parse(from)
      const t = parse(to)
      return f <= t ? mins >= f && mins < t : mins >= f || mins < t
    }
    default:
      return false
  }
}

function waitMs(cfg: WaitStepConfig): number {
  const unitMs = cfg.unit === 'days' ? 86_400_000 : cfg.unit === 'hours' ? 3_600_000 : 60_000
  return Math.max(1_000, cfg.amount * unitMs)
}

function interpolate(s: string, args: ExecuteArgs): string {
  return s.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const [ns, prop] = String(key).split('.')
    if (ns === 'message' && prop === 'text') return String(args.context.message_text ?? '')
    if (ns === 'vars' && prop) return String(args.context.vars?.[prop] ?? '')
    return ''
  })
}

async function appendResults(
  logId: string | null,
  newItems: AutomationLogStepResult[],
  status: 'success' | 'partial' | 'failed' | null,
  errorMessage: string | null,
) {
  if (!logId) return
  const existing = await prisma.automationLog.findUnique({
    where: { id: logId },
    select: { stepsExecuted: true },
  })
  const merged = [
    ...((existing?.stepsExecuted as AutomationLogStepResult[] | undefined) ?? []),
    ...newItems,
  ]
  const update: {
    stepsExecuted: Prisma.InputJsonValue
    status?: 'success' | 'partial' | 'failed'
    errorMessage?: string | null
  } = { stepsExecuted: merged as unknown as Prisma.InputJsonValue }
  if (status !== null) {
    update.status = status
  }
  if (errorMessage) update.errorMessage = errorMessage
  await prisma.automationLog.update({
    where: { id: logId },
    data: update,
  })
}

async function finalizeLog(
  logId: string | null,
  status: 'success' | 'partial' | 'failed',
  errorMessage: string | null,
) {
  if (!logId) return
  await prisma.automationLog.update({
    where: { id: logId },
    data: { status, errorMessage },
  })
}

async function markPending(id: string, status: 'done' | 'failed') {
  await prisma.automationPendingExecution.update({
    where: { id },
    data: { status },
  })
}
