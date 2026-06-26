import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const message = await prisma.message.findFirst({
      where: {
        id,
        status: "draft",
        conversation: { accountId: ctx.accountId },
      },
      select: { id: true },
    });

    if (!message) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    await prisma.message.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
