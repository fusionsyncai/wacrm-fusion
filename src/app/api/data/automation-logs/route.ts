import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const automationId = searchParams.get("automation_id");

    const logs = await prisma.automationLog.findMany({
      where: {
        accountId: ctx.accountId,
        ...(automationId ? { automationId } : {}),
      },
      include: {
        contact: true,
        automation: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json({
      logs: logs.map((l) => ({
        id: l.id,
        automation_id: l.automationId,
        user_id: l.userId,
        contact_id: l.contactId,
        trigger_event: l.triggerEvent,
        steps_executed: l.stepsExecuted,
        status: l.status,
        error_message: l.errorMessage,
        created_at: l.createdAt.toISOString(),
        contact: l.contact
          ? {
              id: l.contact.id,
              name: l.contact.name,
              phone: l.contact.phone,
            }
          : null,
        automation: l.automation ? { name: l.automation.name } : null,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
