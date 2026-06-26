import "server-only";

import type { ToolSet } from "ai";
import { generateText, tool, zodSchema } from "ai";

import { engineSendText } from "@/lib/automations/meta-send";
import { buildToolParametersSchema } from "@/lib/agents/tools/build-schema";
import { executeAgentTool } from "@/lib/agents/tools/execute";
import { getLlmModel } from "@/lib/llm/client";
import { prisma } from "@/lib/prisma";

export interface RunAgentForInboundArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  inboundText: string;
  flowConsumed: boolean;
}

export async function runAgentForInbound(
  args: RunAgentForInboundArgs,
): Promise<void> {
  if (args.flowConsumed) return;
  if (!args.inboundText.trim()) return;

  try {
    let conversation = await prisma.conversation.findFirst({
      where: { id: args.conversationId, accountId: args.accountId },
      select: {
        id: true,
        handlingMode: true,
        aiAgentId: true,
      },
    });

    if (!conversation) return;
    if (conversation.handlingMode !== "AGENT") return;

    if (!conversation.aiAgentId) {
      const autoAgent = await prisma.aiAgent.findFirst({
        where: {
          accountId: args.accountId,
          autoConnect: true,
          isActive: true,
        },
        select: { id: true },
      });
      if (!autoAgent) return;

      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { aiAgentId: autoAgent.id },
        select: {
          id: true,
          handlingMode: true,
          aiAgentId: true,
        },
      });
    }

    if (!conversation.aiAgentId) return;

    const agent = await prisma.aiAgent.findFirst({
      where: {
        id: conversation.aiAgentId,
        accountId: args.accountId,
        isActive: true,
      },
      include: { tools: true },
    });
    if (!agent) return;

    const { model } = await getLlmModel(args.accountId);

    const history = await prisma.message.findMany({
      where: {
        conversationId: args.conversationId,
        status: { not: "draft" },
      },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: {
        senderType: true,
        contentText: true,
        contentType: true,
      },
    });

    const messages = history
      .filter((m) => m.contentType === "text" && m.contentText)
      .map((m) => ({
        role:
          m.senderType === "customer"
            ? ("user" as const)
            : ("assistant" as const),
        content: m.contentText as string,
      }));

    const toolsRecord: ToolSet = {};

    for (const t of agent.tools) {
      const params = Array.isArray(t.parameters)
        ? (t.parameters as {
            field: string;
            type: "string" | "number" | "boolean";
            description: string;
          }[])
        : [];

      const schema = buildToolParametersSchema(params);
      toolsRecord[t.name] = tool({
        description: t.description,
        inputSchema: zodSchema(schema),
        execute: async (input) =>
          executeAgentTool(t.name, input as Record<string, unknown>),
      });
    }

    const result = await generateText({
      model,
      system: agent.systemPrompt,
      messages,
      tools: Object.keys(toolsRecord).length > 0 ? toolsRecord : undefined,
    });

    const replyText = result.text.trim();
    if (!replyText) return;

    if (agent.replyMode === "AUTO") {
      await engineSendText({
        accountId: args.accountId,
        userId: args.userId,
        conversationId: args.conversationId,
        contactId: args.contactId,
        text: replyText,
      });
      return;
    }

    await prisma.message.create({
      data: {
        conversationId: args.conversationId,
        senderType: "bot",
        contentType: "text",
        contentText: replyText,
        status: "draft",
      },
    });
  } catch (err) {
    console.error("[agents] runAgentForInbound failed:", err);
  }
}
