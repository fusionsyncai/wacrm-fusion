import type { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from "@/lib/auth/account";
import { validateToolInput } from "@/lib/agents/validate";
import { toolParametersToJson } from "@/lib/agents/tool-json";
import { serializeAiAgentTool } from "@/lib/db/serialize-ai";
import { prisma } from "@/lib/prisma";

type RouteParams = { params: Promise<{ id: string }> };

async function assertAgent(accountId: string, agentId: string) {
  return prisma.aiAgent.findFirst({
    where: { id: agentId, accountId },
    select: { id: true },
  });
}

export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const ctx = await getCurrentAccount();
    const { id: agentId } = await params;
    const agent = await assertAgent(ctx.accountId, agentId);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }
    const tools = await prisma.aiAgentTool.findMany({
      where: { agentId },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ tools: tools.map(serializeAiAgentTool) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole("agent");
    const { id: agentId } = await params;
    const agent = await assertAgent(ctx.accountId, agentId);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = validateToolInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const tool = await prisma.aiAgentTool.create({
      data: {
        agentId,
        name: parsed.data.name,
        description: parsed.data.description,
        parameters: toolParametersToJson(parsed.data.parameters),
      },
    });

    return NextResponse.json(
      { tool: serializeAiAgentTool(tool) },
      { status: 201 },
    );
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A tool with this name already exists on this agent" },
        { status: 409 },
      );
    }
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request, { params }: RouteParams) {
  try {
    const ctx = await requireRole("agent");
    const { id: agentId } = await params;
    const agent = await assertAgent(ctx.accountId, agentId);
    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.tools)) {
      return NextResponse.json(
        { error: "tools array is required" },
        { status: 400 },
      );
    }

    const validated: Array<{
      id?: string;
      name: string;
      description: string;
      parameters: Prisma.InputJsonValue;
    }> = [];

    for (const item of body.tools) {
      const parsed = validateToolInput(item);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      validated.push({
        id: typeof item.id === "string" ? item.id : undefined,
        name: parsed.data.name,
        description: parsed.data.description,
        parameters: toolParametersToJson(parsed.data.parameters),
      });
    }

    const names = validated.map((t) => t.name);
    if (new Set(names).size !== names.length) {
      return NextResponse.json(
        { error: "Duplicate tool names in payload" },
        { status: 400 },
      );
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.aiAgentTool.findMany({ where: { agentId } });
      const keepIds = new Set(
        validated.map((t) => t.id).filter((id): id is string => !!id),
      );

      const toDelete = existing.filter((e) => !keepIds.has(e.id));
      if (toDelete.length > 0) {
        await tx.aiAgentTool.deleteMany({
          where: { id: { in: toDelete.map((t) => t.id) } },
        });
      }

      for (const tool of validated) {
        if (tool.id) {
          const owned = existing.find((e) => e.id === tool.id);
          if (!owned) continue;
          await tx.aiAgentTool.update({
            where: { id: tool.id },
            data: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          });
        } else {
          await tx.aiAgentTool.create({
            data: {
              agentId,
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          });
        }
      }
    });

    const tools = await prisma.aiAgentTool.findMany({
      where: { agentId },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ tools: tools.map(serializeAiAgentTool) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
