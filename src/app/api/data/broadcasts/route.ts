import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serializeBroadcast, serializeBroadcastRecipient } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const broadcasts = await prisma.broadcast.findMany({
      where: { accountId: ctx.accountId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ broadcasts: broadcasts.map(serializeBroadcast) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);
    if (!body?.name || !body?.template_name) {
      return NextResponse.json(
        { error: "name and template_name required" },
        { status: 400 },
      );
    }

    const broadcast = await prisma.broadcast.create({
      data: {
        userId: ctx.userId,
        accountId: ctx.accountId,
        name: body.name,
        templateName: body.template_name,
        templateLanguage: body.template_language ?? "en_US",
        templateVariables: body.template_variables ?? null,
        audienceFilter: body.audience_filter ?? null,
        scheduledAt: body.scheduled_at ? new Date(body.scheduled_at) : null,
        status: body.status ?? "draft",
        totalRecipients: body.total_recipients ?? 0,
      },
    });

    return NextResponse.json({ broadcast: serializeBroadcast(broadcast) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
