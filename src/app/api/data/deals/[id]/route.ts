import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serializeDeal } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;
    const body = await request.json().catch(() => null);

    const existing = await prisma.deal.findFirst({
      where: { id, accountId: ctx.accountId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const deal = await prisma.deal.update({
      where: { id },
      data: {
        ...(body?.stage_id ? { stageId: body.stage_id } : {}),
        ...(body?.contact_id !== undefined ? { contactId: body.contact_id } : {}),
        ...(body?.assigned_to !== undefined ? { assignedTo: body.assigned_to } : {}),
        ...(typeof body?.title === "string" ? { title: body.title } : {}),
        ...(body?.value !== undefined ? { value: body.value } : {}),
        ...(body?.currency !== undefined ? { currency: body.currency } : {}),
        ...(body?.notes !== undefined ? { notes: body.notes } : {}),
        ...(body?.status ? { status: body.status } : {}),
        ...(body?.expected_close_date !== undefined
          ? {
              expectedCloseDate: body.expected_close_date
                ? new Date(body.expected_close_date)
                : null,
            }
          : {}),
      },
      include: { contact: true, stage: true, assignee: true },
    });

    return NextResponse.json({ deal: serializeDeal(deal) });
  } catch (err) {
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

    const existing = await prisma.deal.findFirst({
      where: { id, accountId: ctx.accountId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.deal.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
