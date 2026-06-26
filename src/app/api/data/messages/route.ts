import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serializeMessage } from "@/lib/db/serialize-entities";
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

    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ messages: messages.map(serializeMessage) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);
    if (!body?.conversation_id) {
      return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: body.conversation_id, accountId: ctx.accountId },
    });
    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const message = await prisma.message.create({
      data: {
        conversationId: body.conversation_id,
        senderType: body.sender_type ?? "agent",
        senderId: body.sender_id ?? ctx.userId,
        contentType: body.content_type ?? "text",
        contentText: body.content_text ?? null,
        mediaUrl: body.media_url ?? null,
        templateName: body.template_name ?? null,
        messageId: body.message_id ?? null,
        status: body.status ?? "sending",
        replyToMessageId: body.reply_to_message_id ?? null,
        interactiveReplyId: body.interactive_reply_id ?? null,
      },
    });

    return NextResponse.json({ message: serializeMessage(message) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);
    if (!body?.id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const existing = await prisma.message.findFirst({
      where: {
        id: body.id,
        conversation: { accountId: ctx.accountId },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const message = await prisma.message.update({
      where: { id: body.id },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.message_id !== undefined ? { messageId: body.message_id } : {}),
        ...(body.content_text !== undefined ? { contentText: body.content_text } : {}),
        ...(body.media_url !== undefined ? { mediaUrl: body.media_url } : {}),
      },
    });

    return NextResponse.json({ message: serializeMessage(message) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
