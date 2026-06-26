import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serializeTag } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const tags = await prisma.tag.findMany({
      where: { accountId: ctx.accountId },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ tags: tags.map(serializeTag) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = await request.json().catch(() => null);
    if (!body?.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const tag = await prisma.tag.create({
      data: {
        userId: ctx.userId,
        accountId: ctx.accountId,
        name: body.name.trim(),
        color: typeof body.color === "string" ? body.color : "#3b82f6",
      },
    });

    return NextResponse.json({ tag: serializeTag(tag) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
