import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { serializeMemberPresence } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const rows = await prisma.memberPresence.findMany({
      where: { accountId: ctx.accountId },
    });
    return NextResponse.json({ presence: rows.map(serializeMemberPresence) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = await request.json().catch(() => null);
    const status = body?.status === "away" ? "away" : "online";

    await prisma.memberPresence.upsert({
      where: { userId: ctx.userId },
      create: {
        userId: ctx.userId,
        accountId: ctx.accountId,
        status,
        lastSeenAt: new Date(),
      },
      update: {
        status,
        lastSeenAt: new Date(),
        accountId: ctx.accountId,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
