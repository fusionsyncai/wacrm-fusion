// TODO: support image/voice inbound for agent context
// TODO: support HTTP/webhook-backed tool execution

/** v1 stub — echoes args so the model can continue the conversation. */
export async function executeAgentTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (toolName === "getWeather") {
    const city =
      typeof args.city === "string"
        ? args.city
        : typeof args.location === "string"
          ? args.location
          : "unknown";
    return {
      ok: true,
      city,
      summary: `Weather in ${city}: sunny, 24°C (demo data)`,
    };
  }

  return {
    ok: true,
    tool: toolName,
    args,
    note: "Tool executed (stub response)",
  };
}
