import { z } from "zod";

import type { AiAgentToolParameter } from "@/types";

export function buildToolParametersSchema(
  parameters: AiAgentToolParameter[],
): z.ZodObject<Record<string, z.ZodType>> {
  const shape: Record<string, z.ZodType> = {};

  for (const param of parameters) {
    const desc = param.description || param.field;
    switch (param.type) {
      case "number":
        shape[param.field] = z.number().describe(desc);
        break;
      case "boolean":
        shape[param.field] = z.boolean().describe(desc);
        break;
      default:
        shape[param.field] = z.string().describe(desc);
        break;
    }
  }

  return z.object(shape);
}
