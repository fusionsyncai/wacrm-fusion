import type { BroadcastRecipientStatus } from "@/generated/prisma/client";
import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serializeBroadcastRecipient } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const broadcastId = searchParams.get("broadcast_id");
    if (!broadcastId) {
      return NextResponse.json({ error: "broadcast_id required" }, { status: 400 });
    }

    const broadcast = await prisma.broadcast.findFirst({
      where: { id: broadcastId, accountId: ctx.accountId },
    });
    if (!broadcast) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const recipients = await prisma.broadcastRecipient.findMany({
      where: { broadcastId },
      include: { contact: true },
    });

    return NextResponse.json({ recipients: recipients.map(serializeBroadcastRecipient) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);
    if (!body?.broadcast_id) {
      return NextResponse.json({ error: "broadcast_id required" }, { status: 400 });
    }

    const broadcast = await prisma.broadcast.findFirst({
      where: { id: body.broadcast_id, accountId: ctx.accountId },
    });
    if (!broadcast) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (Array.isArray(body.recipients)) {
      const rows = body.recipients as Array<{ contact_id: string; status?: string }>;
      await prisma.broadcastRecipient.createMany({
        data: rows.map((r) => ({
          broadcastId: body.broadcast_id,
          contactId: r.contact_id,
          status: (r.status ?? "pending") as BroadcastRecipientStatus,
        })),
        skipDuplicates: true,
      });
      return NextResponse.json({ success: true });
    }

    if (!body.contact_id) {
      return NextResponse.json({ error: "contact_id required" }, { status: 400 });
    }

    const recipient = await prisma.broadcastRecipient.create({
      data: {
        broadcastId: body.broadcast_id,
        contactId: body.contact_id,
        status: body.status ?? "pending",
      },
    });

    return NextResponse.json(
      { recipient: serializeBroadcastRecipient(recipient) },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);
    if (!body?.id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const existing = await prisma.broadcastRecipient.findFirst({
      where: { id: body.id, broadcast: { accountId: ctx.accountId } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const recipient = await prisma.broadcastRecipient.update({
      where: { id: body.id },
      data: {
        ...(body?.status ? { status: body.status } : {}),
        ...(body?.sent_at !== undefined
          ? { sentAt: body.sent_at ? new Date(body.sent_at) : null }
          : {}),
        ...(body?.delivered_at !== undefined
          ? { deliveredAt: body.delivered_at ? new Date(body.delivered_at) : null }
          : {}),
        ...(body?.read_at !== undefined
          ? { readAt: body.read_at ? new Date(body.read_at) : null }
          : {}),
        ...(body?.replied_at !== undefined
          ? { repliedAt: body.replied_at ? new Date(body.replied_at) : null }
          : {}),
        ...(body?.error_message !== undefined ? { errorMessage: body.error_message } : {}),
        ...(body?.whatsapp_message_id !== undefined
          ? { whatsappMessageId: body.whatsapp_message_id }
          : {}),
      },
    });

    return NextResponse.json({ recipient: serializeBroadcastRecipient(recipient) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
