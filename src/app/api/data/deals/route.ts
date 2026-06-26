import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serializeDeal } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const contactId = searchParams.get("contact_id");
    const pipelineId = searchParams.get("pipeline_id");

    const where: { accountId: string; contactId?: string; pipelineId?: string } = {
      accountId: ctx.accountId,
    };
    if (contactId) where.contactId = contactId;
    if (pipelineId) where.pipelineId = pipelineId;

    const deals = await prisma.deal.findMany({
      where,
      include: { contact: true, stage: true, assignee: true },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json({ deals: deals.map(serializeDeal) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);
    if (!body?.pipeline_id || !body?.stage_id || !body?.title) {
      return NextResponse.json(
        { error: "pipeline_id, stage_id, title required" },
        { status: 400 },
      );
    }

    const deal = await prisma.deal.create({
      data: {
        userId: ctx.userId,
        accountId: ctx.accountId,
        pipelineId: body.pipeline_id,
        stageId: body.stage_id,
        contactId: body.contact_id ?? null,
        conversationId: body.conversation_id ?? null,
        assignedTo: body.assigned_to ?? null,
        title: body.title,
        value: body.value ?? 0,
        currency: body.currency ?? null,
        notes: body.notes ?? null,
        expectedCloseDate: body.expected_close_date
          ? new Date(body.expected_close_date)
          : null,
        status: body.status ?? "open",
      },
      include: { contact: true, stage: true, assignee: true },
    });

    return NextResponse.json({ deal: serializeDeal(deal) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
