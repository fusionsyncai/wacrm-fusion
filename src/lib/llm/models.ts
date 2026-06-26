import type { LlmProvider } from "@/types";

export const LLM_OPENAI_MODEL_IDS: readonly string[] = [
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-4o-mini",
  "gpt-4o",
];

export const LLM_GROQ_MODEL_IDS: readonly string[] = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
];

export const LLM_OPENROUTER_MODEL_IDS: readonly string[] = [
  "openrouter/free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen2.5-72b-instruct:free",
  "google/gemma-4-26b-a4b-it:free",
  "deepseek/deepseek-chat-v3:free",
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "anthropic/claude-3.5-haiku",
  "mistralai/mistral-small-3",
];

export const LLM_GOOGLE_MODEL_IDS: readonly string[] = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
];

const PROVIDER_MODELS: Record<LlmProvider, readonly string[]> = {
  OPENAI: LLM_OPENAI_MODEL_IDS,
  GEMINI: LLM_GOOGLE_MODEL_IDS,
  OPEN_ROUTER: LLM_OPENROUTER_MODEL_IDS,
  GROQ: LLM_GROQ_MODEL_IDS,
};

export function modelsForProvider(provider: LlmProvider): readonly string[] {
  return PROVIDER_MODELS[provider];
}

export function isValidModelForProvider(
  provider: LlmProvider,
  modelId: string,
): boolean {
  return modelsForProvider(provider).includes(modelId);
}

export const LLM_PROVIDERS: readonly LlmProvider[] = [
  "OPENAI",
  "GEMINI",
  "OPEN_ROUTER",
  "GROQ",
] as const;

export const LLM_PROVIDER_LABELS: Record<LlmProvider, string> = {
  OPENAI: "OpenAI",
  GEMINI: "Google Gemini",
  OPEN_ROUTER: "OpenRouter",
  GROQ: "Groq",
};
