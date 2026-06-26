import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  serializeFlow,
  serializeFlowNode,
} from "@/lib/db/api-serialize";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await context.params;

    const flow = await prisma.flow.findFirst({
      where: { id, accountId: ctx.accountId },
      select: { id: true, name: true },
    });
    if (!flow) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const runs = await prisma.flowRun.findMany({
      where: { flowId: id, accountId: ctx.accountId },
      orderBy: { startedAt: "desc" },
      take: 50,
      include: {
        contact: { select: { id: true, name: true, phone: true } },
      },
    });

    const runIds = runs.map((r) => r.id);
    const events =
      runIds.length > 0
        ? await prisma.flowRunEvent.findMany({
            where: { flowRunId: { in: runIds } },
            orderBy: { createdAt: "asc" },
          })
        : [];

    return NextResponse.json({
      flow: { id: flow.id, name: flow.name },
      runs: runs.map((r) => ({
        id: r.id,
        status: r.status,
        current_node_key: r.currentNodeKey,
        started_at: r.startedAt.toISOString(),
        last_advanced_at: r.lastAdvancedAt.toISOString(),
        ended_at: r.endedAt?.toISOString() ?? null,
        end_reason: r.endReason,
        vars: r.vars,
        reprompt_count: r.repromptCount,
        contact: r.contact,
      })),
      events: events.map((e) => ({
        flow_run_id: e.flowRunId,
        event_type: e.eventType,
        node_key: e.nodeKey,
        payload: e.payload,
        created_at: e.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
