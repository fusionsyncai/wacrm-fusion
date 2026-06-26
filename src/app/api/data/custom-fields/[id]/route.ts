import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serializeCustomField } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { id } = await params;
    const body = await request.json().catch(() => null);

    const existing = await prisma.customField.findFirst({
      where: { id, accountId: ctx.accountId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const field = await prisma.customField.update({
      where: { id },
      data: {
        ...(typeof body?.field_name === "string" ? { fieldName: body.field_name.trim() } : {}),
        ...(typeof body?.field_type === "string" ? { fieldType: body.field_type } : {}),
        ...(body?.field_options !== undefined ? { fieldOptions: body.field_options } : {}),
      },
    });

    return NextResponse.json({ custom_field: serializeCustomField(field) });
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

    const existing = await prisma.customField.findFirst({
      where: { id, accountId: ctx.accountId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.customField.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
