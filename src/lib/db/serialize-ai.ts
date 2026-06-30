import type { AiAgent, AiAgentTool, AiAgentToolParameter } from "@/types";
import type {
  AiAgent as PrismaAiAgent,
  AiAgentTool as PrismaAiAgentTool,
} from "@/generated/prisma/client";

function parseToolParameters(raw: unknown): AiAgentToolParameter[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is AiAgentToolParameter =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as AiAgentToolParameter).field === "string" &&
      typeof (p as AiAgentToolParameter).type === "string" &&
      typeof (p as AiAgentToolParameter).description === "string",
  );
}

export function serializeAiAgentTool(t: PrismaAiAgentTool): AiAgentTool {
  return {
    id: t.id,
    agent_id: t.agentId,
    name: t.name,
    description: t.description,
    parameters: parseToolParameters(t.parameters),
    created_at: t.createdAt.toISOString(),
    updated_at: t.updatedAt.toISOString(),
  };
}

export function serializeAiAgent(
  a: PrismaAiAgent & { tools?: PrismaAiAgentTool[] },
): AiAgent {
  return {
    id: a.id,
    account_id: a.accountId,
    name: a.name,
    description: a.description ?? undefined,
    system_prompt: a.systemPrompt,
    reply_mode: a.replyMode,
    auto_connect: a.autoConnect,
    is_active: a.isActive,
    voice_enabled: a.voiceEnabled,
    voice_id: a.voiceId ?? undefined,
    call_summary_prompt: a.callSummaryPrompt ?? undefined,
    created_at: a.createdAt.toISOString(),
    updated_at: a.updatedAt.toISOString(),
    tools: a.tools?.map(serializeAiAgentTool),
  };
}
