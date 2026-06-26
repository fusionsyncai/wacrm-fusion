import { NextResponse } from "next/server";

import type { FlowNodeType, Prisma } from "@/generated/prisma/client";
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
    });
    if (!flow) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const nodes = await prisma.flowNode.findMany({
      where: { flowId: id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      flow: serializeFlow(flow),
      nodes: nodes.map(serializeFlowNode),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

interface PutBody {
  name?: string;
  description?: string | null;
  trigger_type?: "keyword" | "first_inbound_message" | "manual";
  trigger_config?: Record<string, unknown>;
  entry_node_id?: string | null;
  fallback_policy?: Record<string, unknown>;
  nodes?: Array<{
    node_key: string;
    node_type: string;
    config: Record<string, unknown>;
    position_x?: number;
    position_y?: number;
  }>;
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await context.params;

    const body = (await request.json().catch(() => null)) as PutBody | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (body.name !== undefined && !body.name.trim()) {
      return NextResponse.json(
        { error: "name cannot be empty" },
        { status: 400 },
      );
    }

    const existing = await prisma.flow.findFirst({
      where: { id, accountId: ctx.accountId },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const flowPatch: {
      name?: string;
      description?: string | null;
      triggerType?: PutBody["trigger_type"];
      triggerConfig?: Record<string, unknown>;
      entryNodeId?: string | null;
      fallbackPolicy?: Record<string, unknown>;
    } = {};

    if (body.name !== undefined) flowPatch.name = body.name.trim();
    if (body.description !== undefined) flowPatch.description = body.description;
    if (body.trigger_type !== undefined)
      flowPatch.triggerType = body.trigger_type;
    if (body.trigger_config !== undefined)
      flowPatch.triggerConfig = body.trigger_config;
    if (body.entry_node_id !== undefined)
      flowPatch.entryNodeId = body.entry_node_id;
    if (body.fallback_policy !== undefined)
      flowPatch.fallbackPolicy = body.fallback_policy;

    if (Object.keys(flowPatch).length > 0) {
      await prisma.flow.update({
        where: { id },
        data: {
          ...flowPatch,
          triggerConfig: flowPatch.triggerConfig as Prisma.InputJsonValue | undefined,
          fallbackPolicy: flowPatch.fallbackPolicy as Prisma.InputJsonValue | undefined,
        },
      });
    }

    if (body.nodes !== undefined) {
      await prisma.$transaction(async (tx) => {
        await tx.flowNode.deleteMany({ where: { flowId: id } });
        if (body.nodes!.length > 0) {
          await tx.flowNode.createMany({
            data: body.nodes!.map((n) => ({
              flowId: id,
              nodeKey: n.node_key,
              nodeType: n.node_type as FlowNodeType,
              config: n.config as Prisma.InputJsonValue,
              positionX: n.position_x ?? 0,
              positionY: n.position_y ?? 0,
            })),
          });
        }
      });
    }

    const [flow, nodes] = await Promise.all([
      prisma.flow.findUnique({ where: { id } }),
      prisma.flowNode.findMany({
        where: { flowId: id },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    return NextResponse.json({
      flow: flow ? serializeFlow(flow) : null,
      nodes: nodes.map(serializeFlowNode),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await context.params;

    const result = await prisma.flow.deleteMany({
      where: { id, accountId: ctx.accountId },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
