import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const rows = await prisma.conversation.findMany({
      where: { accountId: ctx.accountId },
      select: { id: true, unreadCount: true },
    });

    const total = rows.filter((r) => r.unreadCount > 0).length;
    return NextResponse.json({ total, rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}
