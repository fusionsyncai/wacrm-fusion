import { NextResponse } from "next/server";

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from "@/lib/auth/account";
import { enforceSingleAutoConnect } from "@/lib/agents/auto-connect";
import { validateAgentInput } from "@/lib/agents/validate";
import { serializeAiAgent } from "@/lib/db/serialize-ai";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const rows = await prisma.aiAgent.findMany({
      where: { accountId: ctx.accountId },
      include: { tools: { orderBy: { name: "asc" } } },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ agents: rows.map(serializeAiAgent) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = validateAgentInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const agent = await prisma.$transaction(async (tx) => {
      const created = await tx.aiAgent.create({
        data: {
          accountId: ctx.accountId,
          ...parsed.data,
        },
        include: { tools: true },
      });
      await enforceSingleAutoConnect(
        ctx.accountId,
        created.id,
        parsed.data.autoConnect,
        tx,
      );
      return created;
    });

    return NextResponse.json(
      { agent: serializeAiAgent(agent) },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
