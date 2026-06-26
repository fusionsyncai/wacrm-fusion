import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serializeContactCustomValue } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get("contact_id");
    const contactIds = searchParams.get("contact_ids");
    const customFieldId = searchParams.get("custom_field_id");
    const operator = searchParams.get("operator");
    const value = searchParams.get("value");

    if (customFieldId && operator && value !== null) {
      const where: {
        customFieldId: string;
        contact: { accountId: string };
        value?: string | { not: string };
      } = {
        customFieldId,
        contact: { accountId: ctx.accountId },
      };
      if (operator === "is") where.value = value;
      else if (operator === "is_not") where.value = { not: value };
      else if (operator === "contains") {
        const values = await prisma.contactCustomValue.findMany({
          where: {
            customFieldId,
            contact: { accountId: ctx.accountId },
            value: { contains: value, mode: "insensitive" },
          },
        });
        return NextResponse.json({ values: values.map(serializeContactCustomValue) });
      }

      const values = await prisma.contactCustomValue.findMany({ where });
      return NextResponse.json({ values: values.map(serializeContactCustomValue) });
    }

    if (contactIds) {
      const ids = contactIds.split(",").filter(Boolean);
      const values = await prisma.contactCustomValue.findMany({
        where: { contact: { accountId: ctx.accountId, id: { in: ids } } },
      });
      return NextResponse.json({ values: values.map(serializeContactCustomValue) });
    }

    if (!contactId) {
      return NextResponse.json({ error: "contact_id required" }, { status: 400 });
    }

    const values = await prisma.contactCustomValue.findMany({
      where: { contactId, contact: { accountId: ctx.accountId } },
    });

    return NextResponse.json({ values: values.map(serializeContactCustomValue) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);
    if (!body?.contact_id || !body?.custom_field_id) {
      return NextResponse.json(
        { error: "contact_id and custom_field_id required" },
        { status: 400 },
      );
    }

    const contact = await prisma.contact.findFirst({
      where: { id: body.contact_id, accountId: ctx.accountId },
    });
    if (!contact) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const value = await prisma.contactCustomValue.upsert({
      where: {
        contactId_customFieldId: {
          contactId: body.contact_id,
          customFieldId: body.custom_field_id,
        },
      },
      create: {
        contactId: body.contact_id,
        customFieldId: body.custom_field_id,
        value: body.value ?? null,
      },
      update: { value: body.value ?? null },
    });

    return NextResponse.json({ value: serializeContactCustomValue(value) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);
    if (!body?.id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const existing = await prisma.contactCustomValue.findFirst({
      where: { id: body.id, contact: { accountId: ctx.accountId } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.contactCustomValue.delete({ where: { id: body.id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
