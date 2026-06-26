import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serializeBroadcast, serializeBroadcastRecipient } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const broadcast = await prisma.broadcast.findFirst({
      where: { id, accountId: ctx.accountId },
    });
    if (!broadcast) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const recipients = await prisma.broadcastRecipient.findMany({
      where: { broadcastId: id },
      include: { contact: true },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      broadcast: serializeBroadcast(broadcast),
      recipients: recipients.map(serializeBroadcastRecipient),
    });
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

    const existing = await prisma.broadcast.findFirst({
      where: { id, accountId: ctx.accountId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const broadcast = await prisma.broadcast.update({
      where: { id },
      data: {
        ...(typeof body?.name === "string" ? { name: body.name } : {}),
        ...(body?.status ? { status: body.status } : {}),
        ...(body?.scheduled_at !== undefined
          ? { scheduledAt: body.scheduled_at ? new Date(body.scheduled_at) : null }
          : {}),
        ...(body?.total_recipients !== undefined
          ? { totalRecipients: body.total_recipients }
          : {}),
        ...(body?.sent_count !== undefined ? { sentCount: body.sent_count } : {}),
        ...(body?.delivered_count !== undefined
          ? { deliveredCount: body.delivered_count }
          : {}),
        ...(body?.read_count !== undefined ? { readCount: body.read_count } : {}),
        ...(body?.replied_count !== undefined ? { repliedCount: body.replied_count } : {}),
        ...(body?.failed_count !== undefined ? { failedCount: body.failed_count } : {}),
        ...(body?.template_variables !== undefined
          ? { templateVariables: body.template_variables }
          : {}),
        ...(body?.audience_filter !== undefined
          ? { audienceFilter: body.audience_filter }
          : {}),
      },
    });

    return NextResponse.json({ broadcast: serializeBroadcast(broadcast) });
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

    const existing = await prisma.broadcast.findFirst({
      where: { id, accountId: ctx.accountId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.broadcast.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
