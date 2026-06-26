import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serializePipeline } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await params;
    const body = await request.json().catch(() => null);

    const existing = await prisma.pipeline.findFirst({
      where: { id, accountId: ctx.accountId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const pipeline = await prisma.pipeline.update({
      where: { id },
      data: {
        ...(typeof body?.name === "string" ? { name: body.name.trim() } : {}),
      },
    });

    return NextResponse.json({ pipeline: serializePipeline(pipeline) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await params;

    const existing = await prisma.pipeline.findFirst({
      where: { id, accountId: ctx.accountId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.pipeline.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
