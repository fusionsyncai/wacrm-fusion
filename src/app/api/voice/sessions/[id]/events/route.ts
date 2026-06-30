import { NextResponse } from "next/server";

import { finalizeVoiceSession } from "@/lib/voice/generate-call-summary";
import { verifyVoiceCallback } from "@/lib/voice/callback-auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!verifyVoiceCallback(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    event?: string;
    transcript?: string;
  } | null;

  if (!body?.event) {
    return NextResponse.json({ error: "event is required" }, { status: 400 });
  }

  const session = await prisma.voiceSession.findUnique({ where: { id } });
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (body.event === "transcript" && typeof body.transcript === "string") {
    console.info("[voice] worker callback transcript", {
      voiceSessionId: id,
      callId: session.whatsappCallId,
      chars: body.transcript.length,
    });
    await prisma.voiceSession.update({
      where: { id },
      data: { transcript: body.transcript },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.event === "ended") {
    console.info("[voice] worker callback ended", {
      voiceSessionId: id,
      callId: session.whatsappCallId,
      status: session.status,
    });
    await finalizeVoiceSession({
      sessionId: id,
      transcript: body.transcript ?? session.transcript ?? undefined,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unsupported event" }, { status: 400 });
}
