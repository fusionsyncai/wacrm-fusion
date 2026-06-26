import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serializeContactNote } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get("contact_id");
    if (!contactId) {
      return NextResponse.json({ error: "contact_id required" }, { status: 400 });
    }

    const notes = await prisma.contactNote.findMany({
      where: { contactId, accountId: ctx.accountId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ notes: notes.map(serializeContactNote) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);
    if (!body?.contact_id || !body?.note_text) {
      return NextResponse.json({ error: "contact_id and note_text required" }, { status: 400 });
    }

    const contact = await prisma.contact.findFirst({
      where: { id: body.contact_id, accountId: ctx.accountId },
    });
    if (!contact) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const note = await prisma.contactNote.create({
      data: {
        contactId: body.contact_id,
        userId: ctx.userId,
        accountId: ctx.accountId,
        noteText: body.note_text,
      },
    });

    return NextResponse.json({ note: serializeContactNote(note) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
