import type {
  Account,
  Broadcast,
  BroadcastRecipient,
  Contact,
  ContactCustomValue,
  ContactNote,
  ContactTag,
  Conversation,
  CustomField,
  Deal,
  Message,
  MessageReaction,
  Pipeline,
  PipelineStage,
  Profile,
  Tag,
} from "@/types";
import type {
  Broadcast as PrismaBroadcast,
  BroadcastRecipient as PrismaBroadcastRecipient,
  Contact as PrismaContact,
  ContactCustomValue as PrismaContactCustomValue,
  ContactNote as PrismaContactNote,
  ContactTag as PrismaContactTag,
  Conversation as PrismaConversation,
  CustomField as PrismaCustomField,
  Deal as PrismaDeal,
  MemberPresence,
  Message as PrismaMessage,
  MessageReaction as PrismaMessageReaction,
  Pipeline as PrismaPipeline,
  PipelineStage as PrismaPipelineStage,
  Profile as PrismaProfile,
  Tag as PrismaTag,
} from "@/generated/prisma/client";

function iso(d: Date | null | undefined): string | undefined {
  return d ? d.toISOString() : undefined;
}

export function serializeContact(c: PrismaContact): Contact {
  return {
    id: c.id,
    user_id: c.userId,
    account_id: c.accountId,
    phone: c.phone,
    name: c.name ?? undefined,
    email: c.email ?? undefined,
    company: c.company ?? undefined,
    avatar_url: c.avatarUrl ?? undefined,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
  };
}

export function serializeTag(t: PrismaTag): Tag {
  return {
    id: t.id,
    user_id: t.userId,
    name: t.name,
    color: t.color,
    created_at: t.createdAt.toISOString(),
  };
}

export function serializeContactTag(ct: PrismaContactTag): ContactTag {
  return {
    id: ct.id,
    contact_id: ct.contactId,
    tag_id: ct.tagId,
  };
}

export function serializeCustomField(f: PrismaCustomField): CustomField {
  return {
    id: f.id,
    user_id: f.userId,
    account_id: f.accountId,
    field_name: f.fieldName,
    field_type: f.fieldType,
    field_options: (f.fieldOptions as Record<string, unknown> | null) ?? undefined,
    created_at: f.createdAt.toISOString(),
  };
}

export function serializeContactCustomValue(
  v: PrismaContactCustomValue,
): ContactCustomValue {
  return {
    id: v.id,
    contact_id: v.contactId,
    custom_field_id: v.customFieldId,
    value: v.value ?? undefined,
  };
}

export function serializeContactNote(n: PrismaContactNote): ContactNote {
  return {
    id: n.id,
    contact_id: n.contactId,
    user_id: n.userId,
    note_text: n.noteText,
    created_at: n.createdAt.toISOString(),
  };
}

export function serializeConversation(
  c: PrismaConversation & { contact?: PrismaContact | null },
): Conversation {
  return {
    id: c.id,
    user_id: c.userId,
    contact_id: c.contactId,
    status: c.status,
    assigned_agent_id: c.assignedAgentId ?? undefined,
    ai_agent_id: c.aiAgentId ?? undefined,
    handling_mode: c.handlingMode,
    last_message_text: c.lastMessageText ?? undefined,
    last_message_at: iso(c.lastMessageAt),
    unread_count: c.unreadCount,
    created_at: c.createdAt.toISOString(),
    updated_at: c.updatedAt.toISOString(),
    contact: c.contact ? serializeContact(c.contact) : undefined,
  };
}

export function serializeMessage(m: PrismaMessage): Message {
  return {
    id: m.id,
    conversation_id: m.conversationId,
    sender_type: m.senderType,
    sender_id: m.senderId ?? undefined,
    content_type: m.contentType,
    content_text: m.contentText ?? undefined,
    media_url: m.mediaUrl ?? undefined,
    template_name: m.templateName ?? undefined,
    message_id: m.messageId ?? undefined,
    status: m.status,
    created_at: m.createdAt.toISOString(),
    reply_to_message_id: m.replyToMessageId ?? undefined,
    interactive_reply_id: m.interactiveReplyId ?? undefined,
  };
}

export function serializeMessageReaction(r: PrismaMessageReaction): MessageReaction {
  return {
    id: r.id,
    message_id: r.messageId,
    conversation_id: r.conversationId,
    actor_type: r.actorType,
    actor_id: r.actorId ?? undefined,
    emoji: r.emoji,
    created_at: r.createdAt.toISOString(),
  };
}

export function serializeProfile(p: PrismaProfile): Profile {
  return {
    id: p.id,
    user_id: p.userId,
    full_name: p.fullName,
    email: p.email,
    avatar_url: p.avatarUrl ?? undefined,
    role: p.role ?? "user",
    beta_features: p.betaFeatures,
    account_id: p.accountId,
    account_role: p.accountRole,
    created_at: p.createdAt.toISOString(),
  };
}

export function serializePipeline(p: PrismaPipeline): Pipeline {
  return {
    id: p.id,
    user_id: p.userId,
    name: p.name,
    created_at: p.createdAt.toISOString(),
  };
}

export function serializePipelineStage(s: PrismaPipelineStage): PipelineStage {
  return {
    id: s.id,
    pipeline_id: s.pipelineId,
    name: s.name,
    position: s.position,
    color: s.color,
    created_at: s.createdAt.toISOString(),
  };
}

export function serializeDeal(
  d: PrismaDeal & {
    contact?: PrismaContact | null;
    stage?: PrismaPipelineStage | null;
    assignee?: PrismaProfile | null;
  },
): Deal {
  return {
    id: d.id,
    user_id: d.userId,
    pipeline_id: d.pipelineId,
    stage_id: d.stageId,
    contact_id: d.contactId,
    conversation_id: d.conversationId ?? undefined,
    assigned_to: d.assignedTo ?? undefined,
    title: d.title,
    value: Number(d.value ?? 0),
    currency: d.currency ?? undefined,
    notes: d.notes ?? undefined,
    expected_close_date: iso(d.expectedCloseDate),
    status: d.status,
    created_at: d.createdAt.toISOString(),
    updated_at: d.updatedAt.toISOString(),
    contact: d.contact ? serializeContact(d.contact) : undefined,
    stage: d.stage ? serializePipelineStage(d.stage) : undefined,
    assignee: d.assignee ? serializeProfile(d.assignee) : undefined,
  };
}

export function serializeBroadcast(b: PrismaBroadcast): Broadcast {
  return {
    id: b.id,
    user_id: b.userId,
    name: b.name,
    template_name: b.templateName,
    template_language: b.templateLanguage,
    template_variables: (b.templateVariables as Record<string, unknown> | null) ?? undefined,
    audience_filter: (b.audienceFilter as Record<string, unknown> | null) ?? undefined,
    scheduled_at: iso(b.scheduledAt),
    status: b.status,
    total_recipients: b.totalRecipients,
    sent_count: b.sentCount,
    delivered_count: b.deliveredCount,
    read_count: b.readCount,
    replied_count: b.repliedCount,
    failed_count: b.failedCount,
    created_at: b.createdAt.toISOString(),
  };
}

export function serializeBroadcastRecipient(
  r: PrismaBroadcastRecipient & { contact?: PrismaContact | null },
): BroadcastRecipient {
  return {
    id: r.id,
    broadcast_id: r.broadcastId,
    contact_id: r.contactId,
    status: r.status,
    sent_at: iso(r.sentAt),
    delivered_at: iso(r.deliveredAt),
    read_at: iso(r.readAt),
    replied_at: iso(r.repliedAt),
    error_message: r.errorMessage ?? undefined,
    whatsapp_message_id: r.whatsappMessageId ?? undefined,
    created_at: r.createdAt.toISOString(),
    contact: r.contact ? serializeContact(r.contact) : undefined,
  };
}

export function serializeMemberPresence(p: MemberPresence) {
  return {
    user_id: p.userId,
    account_id: p.accountId,
    status: p.status,
    last_seen_at: p.lastSeenAt.toISOString(),
  };
}

export function serializeAccountSummary(a: Pick<Account, "id" | "name"> & {
  default_currency?: string;
}) {
  return {
    id: a.id,
    name: a.name,
    default_currency: a.default_currency,
  };
}
