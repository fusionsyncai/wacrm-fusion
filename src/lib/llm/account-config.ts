import "server-only";

import type { LlmProvider } from "@/types";
import { prisma } from "@/lib/prisma";

/** Resolve which provider config agents should use for this account. */
export async function resolveDefaultLlmProvider(
  accountId: string,
  provider?: LlmProvider,
): Promise<LlmProvider | null> {
  if (provider) return provider;

  const marked = await prisma.accountLlmConfig.findFirst({
    where: { accountId, isDefault: true },
    select: { provider: true },
  });
  if (marked) return marked.provider;

  const first = await prisma.accountLlmConfig.findFirst({
    where: { accountId },
    orderBy: { createdAt: "asc" },
    select: { provider: true },
  });
  return first?.provider ?? null;
}

export async function loadAccountLlmConfig(
  accountId: string,
  provider?: LlmProvider,
) {
  const resolved = await resolveDefaultLlmProvider(accountId, provider);
  if (!resolved) return null;

  return prisma.accountLlmConfig.findUnique({
    where: {
      accountId_provider: { accountId, provider: resolved },
    },
  });
}

/** Ensure exactly one default when multiple configs exist. */
export async function enforceSingleDefaultLlmProvider(
  accountId: string,
  defaultProvider: LlmProvider,
): Promise<void> {
  await prisma.$transaction([
    prisma.accountLlmConfig.updateMany({
      where: { accountId, provider: { not: defaultProvider } },
      data: { isDefault: false },
    }),
    prisma.accountLlmConfig.update({
      where: {
        accountId_provider: { accountId, provider: defaultProvider },
      },
      data: { isDefault: true },
    }),
  ]);
}
