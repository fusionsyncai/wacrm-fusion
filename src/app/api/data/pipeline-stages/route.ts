import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { serializePipelineStage } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = await request.json().catch(() => null);

    if (Array.isArray(body?.stages)) {
      const stages = body.stages as Array<{
        id?: string;
        pipeline_id: string;
        name: string;
        position: number;
        color?: string;
      }>;

      const pipeline = await prisma.pipeline.findFirst({
        where: { id: stages[0]?.pipeline_id, accountId: ctx.accountId },
      });
      if (!pipeline) {
        return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
      }

      const results = await Promise.all(
        stages.map((s) =>
          prisma.pipelineStage.upsert({
            where: { id: s.id ?? "00000000-0000-0000-0000-000000000000" },
            create: {
              pipelineId: s.pipeline_id,
              name: s.name,
              position: s.position,
              color: s.color ?? "#3b82f6",
            },
            update: {
              name: s.name,
              position: s.position,
              color: s.color ?? "#3b82f6",
            },
          }),
        ),
      );

      return NextResponse.json({ stages: results.map(serializePipelineStage) });
    }

    if (!body?.pipeline_id || !body?.name) {
      return NextResponse.json({ error: "pipeline_id and name required" }, { status: 400 });
    }

    const pipeline = await prisma.pipeline.findFirst({
      where: { id: body.pipeline_id, accountId: ctx.accountId },
    });
    if (!pipeline) {
      return NextResponse.json({ error: "Pipeline not found" }, { status: 404 });
    }

    const stage = await prisma.pipelineStage.create({
      data: {
        pipelineId: body.pipeline_id,
        name: body.name,
        position: body.position ?? 0,
        color: body.color ?? "#3b82f6",
      },
    });

    return NextResponse.json({ stage: serializePipelineStage(stage) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = await request.json().catch(() => null);
    if (!body?.id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const existing = await prisma.pipelineStage.findFirst({
      where: { id: body.id, pipeline: { accountId: ctx.accountId } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const stage = await prisma.pipelineStage.update({
      where: { id: body.id },
      data: {
        ...(typeof body?.name === "string" ? { name: body.name } : {}),
        ...(body?.position !== undefined ? { position: body.position } : {}),
        ...(typeof body?.color === "string" ? { color: body.color } : {}),
      },
    });

    return NextResponse.json({ stage: serializePipelineStage(stage) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = await request.json().catch(() => null);
    if (!body?.id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const existing = await prisma.pipelineStage.findFirst({
      where: { id: body.id, pipeline: { accountId: ctx.accountId } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.pipelineStage.delete({ where: { id: body.id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
