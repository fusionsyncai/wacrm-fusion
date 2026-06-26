import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { findExistingContact } from "@/lib/contacts/dedupe.server";
import { isUniqueViolation } from "@/lib/contacts/dedupe";
import { serializeContact } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const contact = await prisma.contact.findFirst({
      where: { id, accountId: ctx.accountId },
    });

    if (!contact) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ contact: serializeContact(contact) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

    const existing = await prisma.contact.findFirst({
      where: { id, accountId: ctx.accountId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const contact = await prisma.contact.update({
      where: { id },
      data: {
        ...(typeof body.name === "string" ? { name: body.name.trim() || null } : {}),
        ...(typeof body.phone === "string" ? { phone: body.phone.trim() } : {}),
        ...(typeof body.email === "string" ? { email: body.email.trim() || null } : {}),
        ...(typeof body.company === "string" ? { company: body.company.trim() || null } : {}),
        ...(typeof body.avatar_url === "string" ? { avatarUrl: body.avatar_url } : {}),
      },
    });

    if (Array.isArray(body.tag_ids)) {
      await prisma.contactTag.deleteMany({ where: { contactId: id } });
      const tagIds = body.tag_ids as string[];
      if (tagIds.length > 0) {
        await prisma.contactTag.createMany({
          data: tagIds.map((tagId) => ({ contactId: id, tagId })),
          skipDuplicates: true,
        });
      }
    }

    return NextResponse.json({ contact: serializeContact(contact) });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { error: "A contact with this phone number already exists", code: "23505" },
        { status: 409 },
      );
    }
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const existing = await prisma.contact.findFirst({
      where: { id, accountId: ctx.accountId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.contact.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
