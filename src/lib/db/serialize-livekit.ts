import type { AccountLivekitConfig } from "@/generated/prisma/client";
import type { AccountLivekitConfig as AccountLivekitConfigDto } from "@/types";

export function serializeAccountLivekitConfig(
  row: AccountLivekitConfig,
): AccountLivekitConfigDto {
  return {
    livekit_url: row.livekitUrl,
    agent_name: row.agentName,
    has_api_key: !!row.apiKey,
    has_api_secret: !!row.apiSecret,
    setup_status: row.setupStatus,
    setup_error: row.setupError ?? undefined,
  };
}
