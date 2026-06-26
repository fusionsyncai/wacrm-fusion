import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { resumePendingExecution } from "@/lib/automations/engine";
import type { AutomationContext } from "@/lib/automations/engine";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  const supplied = request.headers.get("x-cron-secret");
  if (supplied !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const due = await prisma.automationPendingExecution.findMany({
    where: {
      status: "pending",
      runAt: { lte: now },
    },
    orderBy: { runAt: "asc" },
    take: 50,
  });

  if (due.length === 0) return NextResponse.json({ processed: 0 });

  let processed = 0;
  for (const row of due) {
    const claim = await prisma.automationPendingExecution.updateMany({
      where: { id: row.id, status: "pending" },
      data: { status: "running" },
    });
    if (claim.count === 0) continue;

    await resumePendingExecution({
      id: row.id,
      automation_id: row.automationId,
      account_id: row.accountId,
      user_id: row.userId,
      contact_id: row.contactId ?? null,
      log_id: row.logId ?? null,
      parent_step_id: row.parentStepId ?? null,
      branch: (row.branch as "yes" | "no" | null) ?? null,
      next_step_position: row.nextStepPosition,
      context: (row.context as AutomationContext) ?? {},
    });
    processed++;
  }

  return NextResponse.json({ processed });
}
