import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serializePipeline, serializePipelineStage } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const pipelines = await prisma.pipeline.findMany({
      where: { accountId: ctx.accountId },
      include: { pipelineStages: { orderBy: { position: "asc" } } },
    });

    return NextResponse.json({
      pipelines: pipelines.map((p) => ({
        ...serializePipeline(p),
        stages: p.pipelineStages.map(serializePipelineStage),
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = await request.json().catch(() => null);
    if (!body?.name || typeof body.name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const pipeline = await prisma.pipeline.create({
      data: {
        userId: ctx.userId,
        accountId: ctx.accountId,
        name: body.name.trim(),
      },
    });

    return NextResponse.json({ pipeline: serializePipeline(pipeline) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
