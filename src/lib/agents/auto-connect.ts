import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

/** Ensure at most one autoConnect agent per account. */
export async function enforceSingleAutoConnect(
  accountId: string,
  agentId: string,
  autoConnect: boolean,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  if (!autoConnect) return;
  await tx.aiAgent.updateMany({
    where: {
      accountId,
      id: { not: agentId },
      autoConnect: true,
    },
    data: { autoConnect: false },
  });
}
