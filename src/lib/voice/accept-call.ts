import "server-only";

import { RoomAgentDispatch, SessionDescription } from "@livekit/protocol";
import { ConnectorClient } from "livekit-server-sdk";

import type { DecryptedLivekitConfig } from "@/lib/livekit/account-config";
import type { ResolvedVoiceAgent } from "@/lib/voice/resolve-voice-agent";
import { voiceSessionCallbackUrl } from "@/lib/voice/callback-auth";
import type { WhatsAppCallSessionSdp } from "@/lib/voice/whatsapp-call-webhook";

const WHATSAPP_CLOUD_API_VERSION =
  process.env.WHATSAPP_CLOUD_API_VERSION?.trim() || "24.0";

export async function acceptWhatsAppVoiceCall(args: {
  livekit: DecryptedLivekitConfig;
  phoneNumberId: string;
  accessToken: string;
  callId: string;
  session: WhatsAppCallSessionSdp;
  roomName: string;
  voiceSessionId: string;
  agent: ResolvedVoiceAgent;
  contactName?: string;
}): Promise<{ roomName: string }> {
  const connector = new ConnectorClient(
    args.livekit.livekitHttpUrl,
    args.livekit.apiKey,
    args.livekit.apiSecret,
  );

  const metadata = JSON.stringify({
    voice_session_id: args.voiceSessionId,
    agent_id: args.agent.id,
    agent_name: args.agent.name,
    system_prompt: args.agent.systemPrompt,
    voice_id: args.agent.voiceId,
    tools: args.agent.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
    callback_url: voiceSessionCallbackUrl(args.voiceSessionId),
  });

  console.info("[voice] acceptWhatsAppCall request", {
    callId: args.callId,
    roomName: args.roomName,
    voiceSessionId: args.voiceSessionId,
    agentName: args.livekit.agentName,
    sdpType: args.session.sdpType,
  });

  const response = await connector.acceptWhatsAppCall({
    whatsappPhoneNumberId: args.phoneNumberId,
    whatsappApiKey: args.accessToken,
    whatsappCloudApiVersion: WHATSAPP_CLOUD_API_VERSION,
    whatsappCallId: args.callId,
    sdp: new SessionDescription({
      type: args.session.sdpType,
      sdp: args.session.sdp,
    }),
    roomName: args.roomName,
    participantName: args.contactName,
    agents: [
      new RoomAgentDispatch({
        agentName: args.livekit.agentName,
        metadata,
      }),
    ],
  });

  console.info("[voice] acceptWhatsAppCall response", {
    callId: args.callId,
    roomName: response.roomName || args.roomName,
  });

  return { roomName: response.roomName || args.roomName };
}

export async function disconnectWhatsAppVoiceCall(args: {
  livekit: DecryptedLivekitConfig;
  callId: string;
  accessToken: string;
}): Promise<void> {
  const connector = new ConnectorClient(
    args.livekit.livekitHttpUrl,
    args.livekit.apiKey,
    args.livekit.apiSecret,
  );
  await connector.disconnectWhatsAppCall(args.callId, args.accessToken);
}
