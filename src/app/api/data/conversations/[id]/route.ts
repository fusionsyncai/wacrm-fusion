import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serializeConversation } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const conversation = await prisma.conversation.findFirst({
      where: { id, accountId: ctx.accountId },
      include: { contact: true },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ conversation: serializeConversation(conversation) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    const body = await request.json().catch(() => null);

    const existing = await prisma.conversation.findFirst({
      where: { id, accountId: ctx.accountId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (body?.ai_agent_id !== undefined && body.ai_agent_id !== null) {
      const agent = await prisma.aiAgent.findFirst({
        where: { id: body.ai_agent_id, accountId: ctx.accountId },
        select: { id: true },
      });
      if (!agent) {
        return NextResponse.json(
          { error: "AI agent not found on this account" },
          { status: 400 },
        );
      }
    }

    const conversation = await prisma.conversation.update({
      where: { id },
      data: {
        ...(body?.status ? { status: body.status } : {}),
        ...(body?.assigned_agent_id !== undefined
          ? { assignedAgentId: body.assigned_agent_id }
          : {}),
        ...(body?.ai_agent_id !== undefined
          ? { aiAgentId: body.ai_agent_id }
          : {}),
        ...(body?.handling_mode === "AGENT" || body?.handling_mode === "HUMAN"
          ? { handlingMode: body.handling_mode }
          : {}),
        ...(body?.unread_count !== undefined ? { unreadCount: body.unread_count } : {}),
        ...(body?.last_message_text !== undefined
          ? { lastMessageText: body.last_message_text }
          : {}),
        ...(body?.last_message_at !== undefined
          ? { lastMessageAt: body.last_message_at ? new Date(body.last_message_at) : null }
          : {}),
      },
      include: { contact: true },
    });

    return NextResponse.json({ conversation: serializeConversation(conversation) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
