import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  loadActivity,
  loadConversationsSeries,
  loadMetrics,
  loadPipelineDonut,
  loadResponseTime,
} from "@/lib/dashboard/queries";

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    switch (type) {
      case "metrics":
        return NextResponse.json({ metrics: await loadMetrics(ctx.accountId) });
      case "conversations-series": {
        const days = Number(searchParams.get("days") ?? "30");
        const rangeDays = days === 7 || days === 30 || days === 90 ? days : 30;
        return NextResponse.json({
          series: await loadConversationsSeries(ctx.accountId, rangeDays),
        });
      }
      case "pipeline-donut":
        return NextResponse.json({
          pipeline: await loadPipelineDonut(ctx.accountId),
        });
      case "response-time":
        return NextResponse.json({
          response_time: await loadResponseTime(ctx.accountId),
        });
      case "activity": {
        const limit = Number(searchParams.get("limit") ?? "20");
        return NextResponse.json({
          activity: await loadActivity(ctx.accountId, limit),
        });
      }
      default:
        return NextResponse.json({ error: "Unknown type" }, { status: 400 });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
