import "server-only";

import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import { loadAccountLlmConfig } from "@/lib/llm/account-config";
import { isValidModelForProvider } from "@/lib/llm/models";
import { decrypt } from "@/lib/whatsapp/encryption";
import type { LlmProvider } from "@/types";

export async function getLlmModel(
  accountId: string,
  provider?: LlmProvider,
): Promise<{ model: LanguageModel; provider: LlmProvider; modelId: string }> {
  const config = await loadAccountLlmConfig(accountId, provider);

  if (!config) {
    throw new Error("LLM is not configured for this account");
  }

  let apiKey: string;
  try {
    apiKey = decrypt(config.apiKey);
  } catch {
    throw new Error("Stored LLM API key could not be decrypted");
  }

  if (!isValidModelForProvider(config.provider, config.modelId)) {
    throw new Error(
      `Model "${config.modelId}" is not valid for provider ${config.provider}`,
    );
  }

  const model = buildModel(config.provider, config.modelId, apiKey);
  return { model, provider: config.provider, modelId: config.modelId };
}

function buildModel(
  provider: LlmProvider,
  modelId: string,
  apiKey: string,
): LanguageModel {
  switch (provider) {
    case "OPENAI": {
      const openai = createOpenAI({ apiKey });
      return openai(modelId);
    }
    case "GEMINI": {
      const google = createGoogleGenerativeAI({ apiKey });
      return google(modelId);
    }
    case "GROQ": {
      const groq = createGroq({ apiKey });
      return groq(modelId);
    }
    case "OPEN_ROUTER": {
      const openrouter = createOpenAI({
        apiKey,
        baseURL: "https://openrouter.ai/api/v1",
      });
      return openrouter(modelId);
    }
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported LLM provider: ${_exhaustive}`);
    }
  }
}

/** Lightweight connectivity check — one minimal completion. */
export async function testLlmConnection(
  accountId: string,
  provider: LlmProvider,
): Promise<void> {
  const { model } = await getLlmModel(accountId, provider);
  const { generateText } = await import("ai");
  await generateText({
    model,
    prompt: "Reply with exactly: ok",
    maxOutputTokens: 8,
  });
}
