import { describe, expect, it } from "vitest";

import { buildToolParametersSchema } from "@/lib/agents/tools/build-schema";
import {
  isValidModelForProvider,
  modelsForProvider,
} from "@/lib/llm/models";

describe("modelsForProvider", () => {
  it("returns OpenAI models", () => {
    expect(modelsForProvider("OPENAI")).toContain("gpt-4o");
  });

  it("validates model ids per provider", () => {
    expect(isValidModelForProvider("GROQ", "openai/gpt-oss-20b")).toBe(true);
    expect(isValidModelForProvider("OPENAI", "not-a-model")).toBe(false);
  });
});

describe("buildToolParametersSchema", () => {
  it("builds a zod object from parameter rows", () => {
    const schema = buildToolParametersSchema([
      { field: "city", type: "string", description: "City name" },
      { field: "celsius", type: "boolean", description: "Use Celsius" },
    ]);
    const parsed = schema.parse({ city: "Paris", celsius: true });
    expect(parsed).toEqual({ city: "Paris", celsius: true });
  });
});
