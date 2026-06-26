import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { isUniqueViolation } from "@/lib/contacts/dedupe";
import { serializeContact } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() ?? "";
    const page = Math.max(0, Number(searchParams.get("page") ?? "0"));
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("page_size") ?? "25")));
    const contactIds = searchParams.get("contact_ids");
    const phones = searchParams.get("phones");

    if (phones) {
      const phoneList = phones.split(",").filter(Boolean);
      const contacts = await prisma.contact.findMany({
        where: { accountId: ctx.accountId, phone: { in: phoneList } },
      });
      return NextResponse.json({ contacts: contacts.map(serializeContact) });
    }

    if (contactIds) {
      const ids = contactIds.split(",").filter(Boolean);
      const contacts = await prisma.contact.findMany({
        where: { accountId: ctx.accountId, id: { in: ids } },
      });
      return NextResponse.json({ contacts: contacts.map(serializeContact) });
    }

    const where: Prisma.ContactWhereInput = { accountId: ctx.accountId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    const [totalCount, contacts] = await Promise.all([
      prisma.contact.count({ where }),
      prisma.contact.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page * pageSize,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({
      contacts: contacts.map(serializeContact),
      total_count: totalCount,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);
    if (!body?.phone || typeof body.phone !== "string") {
      return NextResponse.json({ error: "phone is required" }, { status: 400 });
    }

    const contact = await prisma.contact.create({
      data: {
        userId: ctx.userId,
        accountId: ctx.accountId,
        phone: body.phone.trim(),
        name: typeof body.name === "string" ? body.name.trim() || null : null,
        email: typeof body.email === "string" ? body.email.trim() || null : null,
        company: typeof body.company === "string" ? body.company.trim() || null : null,
        avatarUrl: typeof body.avatar_url === "string" ? body.avatar_url : null,
      },
    });

    const tagIds = Array.isArray(body.tag_ids) ? (body.tag_ids as string[]) : [];
    if (tagIds.length > 0) {
      await prisma.contactTag.createMany({
        data: tagIds.map((tagId) => ({ contactId: contact.id, tagId })),
        skipDuplicates: true,
      });
    }

    return NextResponse.json({ contact: serializeContact(contact) }, { status: 201 });
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

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);
    const ids = Array.isArray(body?.ids) ? (body.ids as string[]) : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "ids required" }, { status: 400 });
    }

    await prisma.contact.deleteMany({
      where: { accountId: ctx.accountId, id: { in: ids } },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
