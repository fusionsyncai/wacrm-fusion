import type { AiAgentToolParameter, AgentReplyMode } from "@/types";

const TOOL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

export function isAgentReplyMode(value: unknown): value is AgentReplyMode {
  return value === "AUTO" || value === "HUMAN";
}

export function parseToolParameters(raw: unknown): AiAgentToolParameter[] | null {
  if (!Array.isArray(raw)) return null;
  const out: AiAgentToolParameter[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const field = (item as { field?: unknown }).field;
    const type = (item as { type?: unknown }).type;
    const description = (item as { description?: unknown }).description;
    if (typeof field !== "string" || !field.trim()) return null;
    if (type !== "string" && type !== "number" && type !== "boolean") return null;
    if (typeof description !== "string") return null;
    out.push({
      field: field.trim(),
      type,
      description: description.trim(),
    });
  }
  return out;
}

export function validateToolInput(input: {
  name?: unknown;
  description?: unknown;
  parameters?: unknown;
}): { ok: true; data: { name: string; description: string; parameters: AiAgentToolParameter[] } } | { ok: false; error: string } {
  if (typeof input.name !== "string" || !input.name.trim()) {
    return { ok: false, error: "Tool name is required" };
  }
  const name = input.name.trim();
  if (!TOOL_NAME_RE.test(name)) {
    return {
      ok: false,
      error:
        "Tool name must start with a letter or underscore and contain only letters, numbers, and underscores",
    };
  }
  if (typeof input.description !== "string" || !input.description.trim()) {
    return { ok: false, error: "Tool description is required" };
  }
  const parameters = parseToolParameters(input.parameters ?? []);
  if (parameters === null) {
    return { ok: false, error: "Invalid tool parameters" };
  }
  const fields = new Set<string>();
  for (const p of parameters) {
    if (fields.has(p.field)) {
      return { ok: false, error: `Duplicate parameter field: ${p.field}` };
    }
    fields.add(p.field);
  }
  return {
    ok: true,
    data: {
      name,
      description: input.description.trim(),
      parameters,
    },
  };
}

export function validateAgentInput(body: {
  name?: unknown;
  description?: unknown;
  system_prompt?: unknown;
  reply_mode?: unknown;
  auto_connect?: unknown;
  is_active?: unknown;
  voice_enabled?: unknown;
  voice_id?: unknown;
  call_summary_prompt?: unknown;
}): { ok: true; data: {
  name: string;
  description: string | null;
  systemPrompt: string;
  replyMode: AgentReplyMode;
  autoConnect: boolean;
  isActive: boolean;
  voiceEnabled: boolean;
  voiceId: string | null;
  callSummaryPrompt: string | null;
} } | { ok: false; error: string } {
  if (typeof body.name !== "string" || !body.name.trim()) {
    return { ok: false, error: "name is required" };
  }
  if (typeof body.system_prompt !== "string" || !body.system_prompt.trim()) {
    return { ok: false, error: "system_prompt is required" };
  }
  const replyMode = body.reply_mode ?? "HUMAN";
  if (!isAgentReplyMode(replyMode)) {
    return { ok: false, error: "reply_mode must be AUTO or HUMAN" };
  }
  return {
    ok: true,
    data: {
      name: body.name.trim(),
      description:
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim()
          : null,
      systemPrompt: body.system_prompt.trim(),
      replyMode,
      autoConnect: body.auto_connect === true,
      isActive: body.is_active === true,
      voiceEnabled: body.voice_enabled === true,
      voiceId:
        typeof body.voice_id === "string" && body.voice_id.trim()
          ? body.voice_id.trim()
          : null,
      callSummaryPrompt:
        typeof body.call_summary_prompt === "string" &&
        body.call_summary_prompt.trim()
          ? body.call_summary_prompt.trim()
          : null,
    },
  };
}
