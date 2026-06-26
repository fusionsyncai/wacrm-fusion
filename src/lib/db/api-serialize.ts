import type {
  AccountInvitation,
  AccountRole,
  Automation,
  Flow,
  FlowNode,
  FlowRun,
  FlowRunEvent,
  MessageTemplate,
  WhatsappConfig,
} from "@/generated/prisma/client";

export function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export function serializeAutomation(a: Automation) {
  return {
    id: a.id,
    account_id: a.accountId,
    user_id: a.userId,
    name: a.name,
    description: a.description,
    trigger_type: a.triggerType,
    trigger_config: a.triggerConfig,
    is_active: a.isActive,
    execution_count: a.executionCount,
    last_executed_at: iso(a.lastExecutedAt),
    created_at: a.createdAt.toISOString(),
    updated_at: a.updatedAt.toISOString(),
  };
}

export function serializeFlow(f: Flow) {
  return {
    id: f.id,
    account_id: f.accountId,
    user_id: f.userId,
    name: f.name,
    description: f.description,
    status: f.status,
    trigger_type: f.triggerType,
    trigger_config: f.triggerConfig,
    entry_node_id: f.entryNodeId,
    fallback_policy: f.fallbackPolicy,
    execution_count: f.executionCount,
    last_executed_at: iso(f.lastExecutedAt),
    created_at: f.createdAt.toISOString(),
    updated_at: f.updatedAt.toISOString(),
  };
}

export function serializeFlowNode(n: FlowNode) {
  return {
    id: n.id,
    flow_id: n.flowId,
    node_key: n.nodeKey,
    node_type: n.nodeType,
    config: n.config,
    position_x: n.positionX,
    position_y: n.positionY,
    created_at: n.createdAt.toISOString(),
  };
}

export function serializeFlowRun(r: FlowRun) {
  return {
    id: r.id,
    flow_id: r.flowId,
    user_id: r.userId,
    account_id: r.accountId,
    contact_id: r.contactId,
    conversation_id: r.conversationId,
    status: r.status,
    current_node_key: r.currentNodeKey,
    last_prompt_message_id: r.lastPromptMessageId,
    vars: r.vars,
    reprompt_count: r.repromptCount,
    started_at: r.startedAt.toISOString(),
    last_advanced_at: r.lastAdvancedAt.toISOString(),
    ended_at: iso(r.endedAt),
    end_reason: r.endReason,
  };
}

export function serializeFlowRunEvent(e: FlowRunEvent) {
  return {
    id: e.id,
    flow_run_id: e.flowRunId,
    event_type: e.eventType,
    node_key: e.nodeKey,
    payload: e.payload,
    created_at: e.createdAt.toISOString(),
  };
}

export function serializeAccountInvitation(i: AccountInvitation) {
  return {
    id: i.id,
    account_id: i.accountId,
    role: i.role as Exclude<AccountRole, "owner">,
    created_by_user_id: i.createdByUserId,
    label: i.label,
    created_at: i.createdAt.toISOString(),
    expires_at: i.expiresAt.toISOString(),
    accepted_at: iso(i.acceptedAt),
    accepted_by_user_id: i.acceptedByUserId,
  };
}

export function serializeMessageTemplate(t: MessageTemplate) {
  return {
    id: t.id,
    user_id: t.userId,
    account_id: t.accountId,
    name: t.name,
    category: t.category,
    language: t.language,
    header_type: t.headerType,
    header_content: t.headerContent,
    body_text: t.bodyText,
    footer_text: t.footerText,
    buttons: t.buttons,
    status: t.status,
    sample_values: t.sampleValues,
    meta_template_id: t.metaTemplateId,
    rejection_reason: t.rejectionReason,
    quality_score: t.qualityScore,
    header_handle: t.headerHandle,
    header_media_url: t.headerMediaUrl,
    submission_error: t.submissionError,
    last_submitted_at: iso(t.lastSubmittedAt),
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
  };
}

export function serializeWhatsappConfigRow(c: WhatsappConfig) {
  return {
    id: c.id,
    user_id: c.userId,
    account_id: c.accountId,
    phone_number_id: c.phoneNumberId,
    waba_id: c.wabaId,
    access_token: c.accessToken,
    verify_token: c.verifyToken,
    status: c.status,
    connected_at: iso(c.connectedAt),
    registered_at: iso(c.registeredAt),
    subscribed_apps_at: iso(c.subscribedAppsAt),
    last_registration_error: c.lastRegistrationError,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}
