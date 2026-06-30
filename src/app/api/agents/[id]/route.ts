import { NextResponse } from "next/server";

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from "@/lib/auth/account";
import { enforceSingleAutoConnect } from "@/lib/agents/auto-connect";
import { validateAgentInput } from "@/lib/agents/validate";
import { serializeAiAgent } from "@/lib/db/serialize-ai";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ id: string }> };

async function loadAgent(accountId: string, id: string) {
  return prisma.aiAgent.findFirst({
    where: { id, accountId },
    include: { tools: { orderBy: { name: "asc" } } },
  });
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;
    const agent = await loadAgent(ctx.accountId, id);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    return NextResponse.json({ agent: serializeAiAgent(agent) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    const existing = await loadAgent(ctx.accountId, id);
    if (!existing) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = validateAgentInput({
      name: body.name ?? existing.name,
      description: body.description ?? existing.description,
      system_prompt: body.system_prompt ?? existing.systemPrompt,
      reply_mode: body.reply_mode ?? existing.replyMode,
      auto_connect:
        body.auto_connect !== undefined ? body.auto_connect : existing.autoConnect,
      is_active:
        body.is_active !== undefined ? body.is_active : existing.isActive,
      voice_enabled:
        body.voice_enabled !== undefined
          ? body.voice_enabled
          : existing.voiceEnabled,
      voice_id: body.voice_id !== undefined ? body.voice_id : existing.voiceId,
      call_summary_prompt:
        body.call_summary_prompt !== undefined
          ? body.call_summary_prompt
          : existing.callSummaryPrompt,
    });
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const agent = await prisma.$transaction(async (tx) => {
      const updated = await tx.aiAgent.update({
        where: { id },
        data: parsed.data,
        include: { tools: { orderBy: { name: "asc" } } },
      });
      await enforceSingleAutoConnect(
        ctx.accountId,
        id,
        parsed.data.autoConnect,
        tx,
      );
      return updated;
    });

    return NextResponse.json({ agent: serializeAiAgent(agent) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    const existing = await loadAgent(ctx.accountId, id);
    if (!existing) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    await prisma.aiAgent.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
