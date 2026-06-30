import "server-only";

import type { AiAgent, AiAgentTool } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type ResolvedVoiceAgent = AiAgent & { tools: AiAgentTool[] };

export async function resolveVoiceAgent(args: {
  accountId: string;
  conversationId?: string | null;
}): Promise<ResolvedVoiceAgent | null> {
  if (args.conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: args.conversationId, accountId: args.accountId },
      select: { aiAgentId: true, handlingMode: true },
    });

    if (conversation?.handlingMode === "HUMAN") return null;

    if (conversation?.aiAgentId) {
      const bound = await prisma.aiAgent.findFirst({
        where: {
          id: conversation.aiAgentId,
          accountId: args.accountId,
          isActive: true,
          voiceEnabled: true,
        },
        include: { tools: true },
      });
      if (bound) return bound;
    }
  }

  return prisma.aiAgent.findFirst({
    where: {
      accountId: args.accountId,
      isActive: true,
      voiceEnabled: true,
      autoConnect: true,
    },
    include: { tools: true },
    orderBy: { updatedAt: "desc" },
  });
}
