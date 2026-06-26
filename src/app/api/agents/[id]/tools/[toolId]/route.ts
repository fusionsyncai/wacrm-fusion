import type { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { toolParametersToJson } from "@/lib/agents/tool-json";
import { validateToolInput } from "@/lib/agents/validate";
import { serializeAiAgentTool } from "@/lib/db/serialize-ai";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ id: string; toolId: string }> };

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole("agent");
    const { id: agentId, toolId } = await params;

    const tool = await prisma.aiAgentTool.findFirst({
      where: { id: toolId, agentId, agent: { accountId: ctx.accountId } },
    });
    if (!tool) {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = validateToolInput({
      name: body.name ?? tool.name,
      description: body.description ?? tool.description,
      parameters: body.parameters ?? tool.parameters,
    });
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const updated = await prisma.aiAgentTool.update({
      where: { id: toolId },
      data: {
        name: parsed.data.name,
        description: parsed.data.description,
        parameters: toolParametersToJson(parsed.data.parameters),
      },
    });

    return NextResponse.json({ tool: serializeAiAgentTool(updated) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole("agent");
    const { id: agentId, toolId } = await params;

    const tool = await prisma.aiAgentTool.findFirst({
      where: { id: toolId, agentId, agent: { accountId: ctx.accountId } },
    });
    if (!tool) {
      return NextResponse.json({ error: "Tool not found" }, { status: 404 });
    }

    await prisma.aiAgentTool.delete({ where: { id: toolId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
