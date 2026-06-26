import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { resolveFallbackPolicy } from "@/lib/flows/fallback";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }

  const supplied = request.headers.get("x-cron-secret") ?? "";
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  const runs = await prisma.flowRun.findMany({
    where: { status: "active" },
    include: {
      flow: { select: { fallbackPolicy: true } },
    },
  });

  if (runs.length === 0) return NextResponse.json({ swept: 0 });

  let swept = 0;
  for (const r of runs) {
    const policy = resolveFallbackPolicy(r.flow.fallbackPolicy ?? null);
    const ageHours =
      (now.getTime() - r.lastAdvancedAt.getTime()) / (1000 * 60 * 60);
    if (ageHours < policy.on_timeout_hours) continue;

    const updated = await prisma.flowRun.updateMany({
      where: { id: r.id, status: "active" },
      data: {
        status: "timed_out",
        endedAt: now,
        endReason: "stale_sweep",
      },
    });

    if (updated.count > 0) {
      await prisma.flowRunEvent.create({
        data: {
          flowRunId: r.id,
          eventType: "timeout",
          payload: {
            age_hours: Math.round(ageHours * 10) / 10,
            policy_hours: policy.on_timeout_hours,
          },
        },
      });
      swept += 1;
    }
  }

  return NextResponse.json({ swept });
}
