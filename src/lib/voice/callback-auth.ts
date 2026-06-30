import "server-only";

export function getVoiceCallbackSecret(): string | null {
  return process.env.VOICE_CALLBACK_SECRET?.trim() || null;
}

export function verifyVoiceCallback(request: Request): boolean {
  const secret = getVoiceCallbackSecret();
  if (!secret) {
    console.error("[voice] VOICE_CALLBACK_SECRET is not set");
    return false;
  }
  return request.headers.get("x-voice-callback-key") === secret;
}

export function publicAppOrigin(): string {
  const configured = process.env.AUTH_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export function voiceSessionCallbackUrl(sessionId: string): string {
  return `${publicAppOrigin()}/api/voice/sessions/${sessionId}/events`;
}
