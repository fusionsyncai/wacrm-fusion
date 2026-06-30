import "server-only";

import { getAccountLivekitConfig } from "@/lib/livekit/account-config";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/whatsapp/encryption";
import { disconnectWhatsAppVoiceCall } from "@/lib/voice/accept-call";
import { finalizeVoiceSession } from "@/lib/voice/generate-call-summary";
import type { WhatsAppInboundCallEvent } from "@/lib/voice/whatsapp-call-webhook";
import {
  isDuplicateCallWebhook,
  isTerminateCallEvent,
} from "@/lib/voice/whatsapp-call-webhook";

export async function handleTerminateWhatsAppCall(
  event: WhatsAppInboundCallEvent,
): Promise<void> {
  if (!isTerminateCallEvent(event)) return;

  console.info("[voice] terminate start", {
    callId: event.callId,
    from: event.fromWaId,
  });

  if (isDuplicateCallWebhook(event.callId, event.event)) {
    console.info("[voice] terminate skipped duplicate", {
      callId: event.callId,
    });
    return;
  }

  const session = await prisma.voiceSession.findUnique({
    where: { whatsappCallId: event.callId },
  });
  if (!session || session.status === "completed") {
    console.info("[voice] terminate no active session", {
      callId: event.callId,
      found: !!session,
      status: session?.status,
    });
    return;
  }

  console.info("[voice] terminate session found", {
    callId: event.callId,
    voiceSessionId: session.id,
    status: session.status,
    hasTranscript: !!session.transcript?.trim(),
  });

  const config = await prisma.whatsappConfig.findFirst({
    where: { phoneNumberId: event.phoneNumberId },
    select: { accessToken: true, accountId: true },
  });

  const livekit = await getAccountLivekitConfig(session.accountId);
  if (livekit && config?.accessToken) {
    try {
      await disconnectWhatsAppVoiceCall({
        livekit,
        callId: event.callId,
        accessToken: decrypt(config.accessToken),
      });
      console.info("[voice] disconnectWhatsAppCall ok", {
        callId: event.callId,
      });
    } catch (err) {
      console.warn("[voice] disconnectWhatsAppCall failed:", err);
    }
  }

  if (session.transcript?.trim()) {
    console.info("[voice] terminate finalizing from transcript", {
      voiceSessionId: session.id,
    });
    await finalizeVoiceSession({
      sessionId: session.id,
      transcript: session.transcript,
    });
    return;
  }

  await prisma.voiceSession.update({
    where: { id: session.id },
    data: {
      status: session.status === "failed" ? "failed" : "active",
      endedAt: new Date(),
    },
  });

  console.info("[voice] terminate ended awaiting worker callback", {
    voiceSessionId: session.id,
    callId: event.callId,
  });
}
