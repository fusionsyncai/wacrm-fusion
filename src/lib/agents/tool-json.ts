import type { AiAgentToolParameter } from "@/types";
import type { Prisma } from "@/generated/prisma/client";

export function toolParametersToJson(
  parameters: AiAgentToolParameter[],
): Prisma.InputJsonValue {
  return parameters as unknown as Prisma.InputJsonValue;
}
