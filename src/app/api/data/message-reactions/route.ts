import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serializeMessageReaction } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get("conversation_id");
    if (!conversationId) {
      return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, accountId: ctx.accountId },
    });
    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const reactions = await prisma.messageReaction.findMany({
      where: { conversationId },
    });

    return NextResponse.json({ reactions: reactions.map(serializeMessageReaction) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);
    if (!body?.message_id || !body?.conversation_id || !body?.emoji) {
      return NextResponse.json({ error: "message_id, conversation_id, emoji required" }, { status: 400 });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: body.conversation_id, accountId: ctx.accountId },
    });
    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const reaction = await prisma.messageReaction.upsert({
      where: {
        messageId_actorType_actorId: {
          messageId: body.message_id,
          actorType: body.actor_type ?? "agent",
          actorId: body.actor_id ?? ctx.userId,
        },
      },
      create: {
        messageId: body.message_id,
        conversationId: body.conversation_id,
        actorType: body.actor_type ?? "agent",
        actorId: body.actor_id ?? ctx.userId,
        emoji: body.emoji,
      },
      update: { emoji: body.emoji },
    });

    return NextResponse.json({ reaction: serializeMessageReaction(reaction) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);
    if (!body?.id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const existing = await prisma.messageReaction.findFirst({
      where: {
        id: body.id,
        conversation: { accountId: ctx.accountId },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.messageReaction.delete({ where: { id: body.id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
