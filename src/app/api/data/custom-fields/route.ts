import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serializeCustomField } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const fields = await prisma.customField.findMany({
      where: { accountId: ctx.accountId },
      orderBy: { fieldName: "asc" },
    });
    return NextResponse.json({ custom_fields: fields.map(serializeCustomField) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = await request.json().catch(() => null);
    if (!body?.field_name || typeof body.field_name !== "string") {
      return NextResponse.json({ error: "field_name is required" }, { status: 400 });
    }

    const field = await prisma.customField.create({
      data: {
        userId: ctx.userId,
        accountId: ctx.accountId,
        fieldName: body.field_name.trim(),
        fieldType: typeof body.field_type === "string" ? body.field_type : "text",
        fieldOptions: body.field_options ?? null,
      },
    });

    return NextResponse.json({ custom_field: serializeCustomField(field) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
