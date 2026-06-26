import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serializeContactTag } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get("contact_id");
    const contactIds = searchParams.get("contact_ids");
    const tagIds = searchParams.get("tag_ids");

    if (tagIds) {
      const ids = tagIds.split(",").filter(Boolean);
      const rows = await prisma.contactTag.findMany({
        where: { tagId: { in: ids }, contact: { accountId: ctx.accountId } },
      });
      return NextResponse.json({ contact_tags: rows.map(serializeContactTag) });
    }

    if (contactIds) {
      const ids = contactIds.split(",").filter(Boolean);
      const rows = await prisma.contactTag.findMany({
        where: { contact: { accountId: ctx.accountId, id: { in: ids } } },
      });
      return NextResponse.json({ contact_tags: rows.map(serializeContactTag) });
    }

    if (!contactId) {
      return NextResponse.json({ error: "contact_id required" }, { status: 400 });
    }

    const rows = await prisma.contactTag.findMany({
      where: { contactId, contact: { accountId: ctx.accountId } },
    });

    return NextResponse.json({ contact_tags: rows.map(serializeContactTag) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);

    if (Array.isArray(body?.rows)) {
      const rows = body.rows as Array<{ contact_id: string; tag_id: string }>;
      await prisma.contactTag.createMany({
        data: rows.map((r) => ({ contactId: r.contact_id, tagId: r.tag_id })),
        skipDuplicates: true,
      });
      return NextResponse.json({ success: true });
    }

    if (!body?.contact_id || !body?.tag_id) {
      return NextResponse.json({ error: "contact_id and tag_id required" }, { status: 400 });
    }

    const contact = await prisma.contact.findFirst({
      where: { id: body.contact_id, accountId: ctx.accountId },
    });
    if (!contact) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const row = await prisma.contactTag.create({
      data: { contactId: body.contact_id, tagId: body.tag_id },
    });

    return NextResponse.json({ contact_tag: serializeContactTag(row) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);

    if (body?.contact_id && !body?.tag_id) {
      await prisma.contactTag.deleteMany({
        where: { contactId: body.contact_id, contact: { accountId: ctx.accountId } },
      });
      return NextResponse.json({ success: true });
    }

    if (!body?.contact_id || !body?.tag_id) {
      return NextResponse.json({ error: "contact_id required (and tag_id unless clearing all)" }, { status: 400 });
    }

    await prisma.contactTag.deleteMany({
      where: {
        contactId: body.contact_id,
        tagId: body.tag_id,
        contact: { accountId: ctx.accountId },
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
