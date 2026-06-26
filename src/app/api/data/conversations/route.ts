import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { serializeConversation } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (id) {
      const conversation = await prisma.conversation.findFirst({
        where: { id, accountId: ctx.accountId },
        include: { contact: true },
      });
      if (!conversation) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ conversation: serializeConversation(conversation) });
    }

    const conversations = await prisma.conversation.findMany({
      where: { accountId: ctx.accountId },
      include: { contact: true },
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    });

    return NextResponse.json({
      conversations: conversations.map(serializeConversation),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
