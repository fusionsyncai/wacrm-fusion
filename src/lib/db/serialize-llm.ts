import type { AccountLlmConfig, LlmProvider } from "@/types";
import type { AccountLlmConfig as PrismaAccountLlmConfig } from "@/generated/prisma/client";

export function serializeAccountLlmConfig(
  c: PrismaAccountLlmConfig,
): AccountLlmConfig {
  return {
    provider: c.provider,
    model_id: c.modelId,
    has_api_key: !!c.apiKey,
    is_default: c.isDefault,
  };
}
