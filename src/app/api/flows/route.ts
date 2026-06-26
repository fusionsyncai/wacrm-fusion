import { NextResponse } from "next/server";

import type { Prisma } from "@/generated/prisma/client";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { getFlowTemplate } from "@/lib/flows/templates";
import {
  serializeFlow,
  serializeFlowNode,
} from "@/lib/db/api-serialize";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const rows = await prisma.flow.findMany({
      where: { accountId: ctx.accountId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ flows: rows.map(serializeFlow) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    const body = (await request.json().catch(() => null)) as
      | {
          name?: string;
          description?: string | null;
          trigger_type?: "keyword" | "first_inbound_message" | "manual";
          trigger_config?: Record<string, unknown>;
          template_slug?: string;
        }
      | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (body.template_slug) {
      const template = getFlowTemplate(body.template_slug);
      if (!template) {
        return NextResponse.json(
          { error: `Unknown template_slug "${body.template_slug}"` },
          { status: 400 },
        );
      }

      const flow = await prisma.$transaction(async (tx) => {
        const created = await tx.flow.create({
          data: {
            userId: ctx.userId,
            accountId: ctx.accountId,
            name: body.name?.trim() || template.name,
            description: template.description,
            status: "draft",
            triggerType: template.trigger_type,
            triggerConfig: template.trigger_config as Prisma.InputJsonValue,
            entryNodeId: template.entry_node_id,
          },
        });

        if (template.nodes.length > 0) {
          await tx.flowNode.createMany({
            data: template.nodes.map((n) => ({
              flowId: created.id,
              nodeKey: n.node_key,
              nodeType: n.node_type,
              config: n.config as Prisma.InputJsonValue,
            })),
          });
        }

        return created;
      });

      return NextResponse.json(
        { flow: serializeFlow(flow) },
        { status: 201 },
      );
    }

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const flow = await prisma.flow.create({
      data: {
        userId: ctx.userId,
        accountId: ctx.accountId,
        name: body.name.trim(),
        description: body.description ?? null,
        status: "draft",
        triggerType: body.trigger_type ?? "keyword",
        triggerConfig: (body.trigger_config ?? {}) as Prisma.InputJsonValue,
      },
    });

    return NextResponse.json({ flow: serializeFlow(flow) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
