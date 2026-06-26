import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { validateFlowForActivation } from "@/lib/flows/validate";
import { serializeFlow } from "@/lib/db/api-serialize";
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await context.params;

    const body = (await request.json().catch(() => null)) as
      | { status?: "draft" | "active" | "archived" }
      | null;
    const status = body?.status;
    if (!status || !["draft", "active", "archived"].includes(status)) {
      return NextResponse.json(
        { error: "status must be one of 'draft' | 'active' | 'archived'" },
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

    if (status === "active") {
      const flow = await prisma.flow.findFirst({
        where: { id, accountId: ctx.accountId },
        select: {
          name: true,
          triggerType: true,
          triggerConfig: true,
          entryNodeId: true,
        },
      });
      const nodes = await prisma.flowNode.findMany({
        where: { flowId: id },
        select: { nodeKey: true, nodeType: true, config: true },
      });

      if (!flow) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }

      const issues = validateFlowForActivation(
        {
          name: flow.name,
          trigger_type: flow.triggerType,
          trigger_config: flow.triggerConfig as Record<string, unknown>,
          entry_node_id: flow.entryNodeId,
        },
        nodes.map((n) => ({
          node_key: n.nodeKey,
          node_type: n.nodeType,
          config: n.config as Record<string, unknown>,
        })),
      );

      const blockers = issues.filter((i) => i.severity === "error");
      if (blockers.length > 0) {
        return NextResponse.json(
          {
            error: "Cannot activate flow — fix the issues below first.",
            issues,
          },
          { status: 422 },
        );
      }
    }

    const updated = await prisma.flow.update({
      where: { id },
      data: { status },
    });

    return NextResponse.json({ flow: serializeFlow(updated) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
