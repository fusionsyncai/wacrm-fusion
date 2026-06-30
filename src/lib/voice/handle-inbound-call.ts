import "server-only";

import { findExistingContact } from "@/lib/contacts/dedupe.server";
import { isUniqueViolation } from "@/lib/contacts/dedupe";
import { getAccountLivekitConfig } from "@/lib/livekit/account-config";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/whatsapp/encryption";
import { acceptWhatsAppVoiceCall } from "@/lib/voice/accept-call";
import { resolveVoiceAgent } from "@/lib/voice/resolve-voice-agent";
import type { WhatsAppInboundCallEvent } from "@/lib/voice/whatsapp-call-webhook";
import {
  isConnectCallEvent,
  isDuplicateCallWebhook,
} from "@/lib/voice/whatsapp-call-webhook";

function logVoice(phase: string, data: Record<string, unknown>) {
  console.info(`[voice] ${phase}`, data);
}

export async function handleInboundWhatsAppCall(
  event: WhatsAppInboundCallEvent,
): Promise<void> {
  logVoice("inbound start", {
    callId: event.callId,
    from: event.fromWaId,
    phoneNumberId: event.phoneNumberId,
    event: event.event,
  });

  if (isDuplicateCallWebhook(event.callId, event.event)) {
    logVoice("inbound skipped duplicate", { callId: event.callId, event: event.event });
    return;
  }

  if (!isConnectCallEvent(event) || !event.session) {
    logVoice("inbound skipped not connect", {
      callId: event.callId,
      event: event.event,
      hasSession: !!event.session,
    });
    return;
  }

  const config = await prisma.whatsappConfig.findFirst({
    where: { phoneNumberId: event.phoneNumberId },
    select: {
      accountId: true,
      userId: true,
      phoneNumberId: true,
      accessToken: true,
      status: true,
    },
  });

  if (!config?.accessToken || config.status !== "connected") {
    console.warn("[voice] no connected WhatsApp config for", event.phoneNumberId);
    return;
  }

  logVoice("whatsapp config ok", {
    callId: event.callId,
    accountId: config.accountId,
  });

  const livekit = await getAccountLivekitConfig(config.accountId);
  if (!livekit) {
    console.warn("[voice] LiveKit not configured for account", config.accountId);
    return;
  }

  logVoice("livekit config ok", {
    callId: event.callId,
    agentName: livekit.agentName,
  });

  let accessToken: string;
  try {
    accessToken = decrypt(config.accessToken);
  } catch (err) {
    console.error("[voice] token decrypt failed:", err);
    return;
  }

  const existingContact = await findExistingContact(
    config.accountId,
    event.fromWaId,
  );
  let contactId = existingContact?.id;
  if (!contactId) {
    try {
      const created = await prisma.contact.create({
        data: {
          accountId: config.accountId,
          userId: config.userId,
          phone: event.fromWaId,
          name: event.fromWaId,
        },
      });
      contactId = created.id;
    } catch (err) {
      if (isUniqueViolation(err)) {
        const raced = await findExistingContact(config.accountId, event.fromWaId);
        contactId = raced?.id;
      }
    }
  }
  if (!contactId) {
    logVoice("inbound aborted no contact", { callId: event.callId });
    return;
  }

  let conversation = await prisma.conversation.findFirst({
    where: { accountId: config.accountId, contactId },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        accountId: config.accountId,
        userId: config.userId,
        contactId,
      },
    });
  }

  logVoice("conversation ready", {
    callId: event.callId,
    conversationId: conversation.id,
    handlingMode: conversation.handlingMode,
    boundAgentId: conversation.aiAgentId,
  });

  const agent = await resolveVoiceAgent({
    accountId: config.accountId,
    conversationId: conversation.id,
  });
  if (!agent) {
    logVoice("inbound aborted no voice agent", {
      callId: event.callId,
      conversationId: conversation.id,
    });
    return;
  }

  logVoice("voice agent resolved", {
    callId: event.callId,
    agentId: agent.id,
    agentName: agent.name,
  });

  if (!conversation.aiAgentId) {
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { aiAgentId: agent.id },
    });
  }

  const voiceSession = await prisma.voiceSession.create({
    data: {
      accountId: config.accountId,
      conversationId: conversation.id,
      contactId,
      aiAgentId: agent.id,
      whatsappCallId: event.callId,
      status: "ringing",
      startedAt: new Date(),
    },
  });

  const roomName = `wacrm-${voiceSession.id}`;

  logVoice("accepting call", {
    callId: event.callId,
    voiceSessionId: voiceSession.id,
    roomName,
    livekitAgentName: livekit.agentName,
  });

  try {
    const accepted = await acceptWhatsAppVoiceCall({
      livekit,
      phoneNumberId: config.phoneNumberId,
      accessToken,
      callId: event.callId,
      session: event.session,
      roomName,
      voiceSessionId: voiceSession.id,
      agent,
      contactName: existingContact?.name ?? event.fromWaId,
    });

    await prisma.voiceSession.update({
      where: { id: voiceSession.id },
      data: {
        status: "active",
        livekitRoomName: accepted.roomName,
      },
    });

    await prisma.accountLivekitConfig.update({
      where: { accountId: config.accountId },
      data: { setupStatus: "ready", setupError: null },
    });

    logVoice("call accepted", {
      callId: event.callId,
      voiceSessionId: voiceSession.id,
      roomName: accepted.roomName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "accept failed";
    console.error("[voice] acceptWhatsAppCall failed:", message);
    await prisma.voiceSession.update({
      where: { id: voiceSession.id },
      data: {
        status: "failed",
        failureReason: message,
        endedAt: new Date(),
      },
    });
    logVoice("call accept failed", {
      callId: event.callId,
      voiceSessionId: voiceSession.id,
      error: message,
    });
  }
}
