export type WhatsAppCallSessionSdp = {
  sdpType: string;
  sdp: string;
};

export type WhatsAppInboundCallEvent = {
  callId: string;
  event: string;
  direction?: string;
  fromWaId: string;
  to?: string;
  timestamp?: string;
  phoneNumberId: string;
  wabaId: string;
  session?: WhatsAppCallSessionSdp;
};

type WebhookCall = {
  id?: string;
  event?: string;
  direction?: string;
  from?: string;
  to?: string;
  timestamp?: string;
  session?: {
    sdp_type?: string;
    sdp?: string;
  };
  connection?: {
    webrtc?: {
      sdp?: string;
    };
  };
};

type WebhookCallsValue = {
  messaging_product?: string;
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  calls?: WebhookCall[];
};

type WebhookBody = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: unknown;
    }>;
  }>;
};

/** Unescape literal `\r\n` from JSON/Meta so WebRTC gets real SDP lines. */
export function normalizeSdp(sdp: string): string {
  let text = sdp.trim();
  if (!text) return text;
  while (text.includes("\\r\\n") || text.includes("\\n") || text.includes("\\r")) {
    text = text.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\\r/g, "");
  }
  const lines = text.split(/\r\n|\n|\r/).map((line) => line.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\r\n")}\r\n`;
}

function extractCallSession(call: WebhookCall): WhatsAppCallSessionSdp | undefined {
  if (call.session?.sdp?.trim()) {
    return {
      sdpType: call.session.sdp_type?.trim() ?? "offer",
      sdp: normalizeSdp(call.session.sdp),
    };
  }
  const raw = call.connection?.webrtc?.sdp;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { type?: string; sdp?: string };
    if (parsed.sdp?.trim()) {
      return {
        sdpType: parsed.type?.trim() ?? "offer",
        sdp: normalizeSdp(parsed.sdp),
      };
    }
  } catch {
    if (typeof raw === "string" && raw.includes("v=0")) {
      return { sdpType: "offer", sdp: normalizeSdp(raw) };
    }
  }
  return undefined;
}

export function parseInboundCallEvents(body: WebhookBody): WhatsAppInboundCallEvent[] {
  const results: WhatsAppInboundCallEvent[] = [];
  if (body.object !== "whatsapp_business_account") return results;

  for (const entry of body.entry ?? []) {
    const wabaId = entry.id;
    if (!wabaId) continue;

    for (const change of entry.changes ?? []) {
      if (change.field !== "calls") continue;
      const value = change.value as WebhookCallsValue | undefined;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      for (const call of value?.calls ?? []) {
        const callId = call.id?.trim();
        const event = call.event?.trim();
        const fromWaId = call.from?.trim();
        if (!callId || !event || !fromWaId) continue;

        results.push({
          callId,
          event,
          direction: call.direction?.trim(),
          fromWaId,
          to: call.to?.trim(),
          timestamp: call.timestamp?.trim(),
          phoneNumberId,
          wabaId,
          session: extractCallSession(call),
        });
      }
    }
  }

  return results;
}

export function isConnectCallEvent(event: WhatsAppInboundCallEvent): boolean {
  return event.event === "connect" && !!event.session?.sdp;
}

export function isTerminateCallEvent(event: WhatsAppInboundCallEvent): boolean {
  return event.event === "terminate";
}

const dedup = new Map<string, number>();
const DEDUP_TTL_MS = 10 * 60 * 1000;

export function isDuplicateCallWebhook(
  callId: string,
  event: string,
): boolean {
  const key = `${callId}:${event}`;
  const now = Date.now();
  const seen = dedup.get(key);
  if (seen && now - seen < DEDUP_TTL_MS) return true;
  dedup.set(key, now);
  if (dedup.size > 500) {
    for (const [k, ts] of dedup) {
      if (now - ts > DEDUP_TTL_MS) dedup.delete(k);
    }
  }
  return false;
}
