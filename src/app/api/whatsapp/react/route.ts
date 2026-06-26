import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { decrypt } from "@/lib/whatsapp/encryption";
import { sendReactionMessage } from "@/lib/whatsapp/meta-api";
import { sanitizePhoneForMeta } from "@/lib/whatsapp/phone-utils";

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    const limit = checkRateLimit(`react:${ctx.userId}`, RATE_LIMITS.react);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json();
    const { message_id, emoji } = body as {
      message_id?: string;
      emoji?: string;
    };

    if (!message_id || typeof emoji !== "string") {
      return NextResponse.json(
        { error: "message_id and emoji are required" },
        { status: 400 },
      );
    }

    const targetMessage = await prisma.message.findUnique({
      where: { id: message_id },
      select: { id: true, messageId: true, conversationId: true },
    });

    if (!targetMessage) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    if (!targetMessage.messageId) {
      return NextResponse.json(
        {
          error: "Cannot react to a message that has not been sent to WhatsApp",
        },
        { status: 400 },
      );
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: targetMessage.conversationId, accountId: ctx.accountId },
      include: { contact: { select: { phone: true } } },
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    if (!conversation.contact?.phone) {
      return NextResponse.json(
        { error: "Contact phone number not found" },
        { status: 400 },
      );
    }

    const config = await prisma.whatsappConfig.findUnique({
      where: { accountId: ctx.accountId },
    });

    if (!config) {
      return NextResponse.json({ error: "WhatsApp not configured." }, { status: 400 });
    }

    const accessToken = decrypt(config.accessToken);
    const sanitizedPhone = sanitizePhoneForMeta(conversation.contact.phone);

    try {
      await sendReactionMessage({
        phoneNumberId: config.phoneNumberId,
        accessToken,
        to: sanitizedPhone,
        targetMessageId: targetMessage.messageId,
        emoji,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown Meta API error";
      console.error("[whatsapp/react] Meta send failed:", message);
      return NextResponse.json({ error: `Meta API error: ${message}` }, { status: 502 });
    }

    if (emoji === "") {
      await prisma.messageReaction.deleteMany({
        where: {
          messageId: targetMessage.id,
          actorType: "agent",
          actorId: ctx.userId,
        },
      });
    } else {
      await prisma.messageReaction.upsert({
        where: {
          messageId_actorType_actorId: {
            messageId: targetMessage.id,
            actorType: "agent",
            actorId: ctx.userId,
          },
        },
        create: {
          messageId: targetMessage.id,
          conversationId: targetMessage.conversationId,
          actorType: "agent",
          actorId: ctx.userId,
          emoji,
        },
        update: { emoji },
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "UnauthorizedError" || err.name === "ForbiddenError")
    ) {
      return toErrorResponse(err);
    }
    console.error("Error in WhatsApp react POST:", err);
    return NextResponse.json({ error: "Failed to react to message" }, { status: 500 });
  }
}
