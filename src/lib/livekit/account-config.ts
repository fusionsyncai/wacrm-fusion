import "server-only";

import type { AccountLivekitConfig } from "@/generated/prisma/client";
import { decrypt } from "@/lib/whatsapp/encryption";
import { prisma } from "@/lib/prisma";

import { normalizeLiveKitHttpUrl } from "./normalize-url";

export interface DecryptedLivekitConfig {
  livekitUrl: string;
  livekitHttpUrl: string;
  apiKey: string;
  apiSecret: string;
  agentName: string;
}

export async function getAccountLivekitConfig(
  accountId: string,
): Promise<DecryptedLivekitConfig | null> {
  const row = await prisma.accountLivekitConfig.findUnique({
    where: { accountId },
  });
  if (!row) return null;
  return decryptLivekitRow(row);
}

export function decryptLivekitRow(
  row: AccountLivekitConfig,
): DecryptedLivekitConfig {
  const livekitUrl = normalizeLiveKitHttpUrl(row.livekitUrl);
  return {
    livekitUrl,
    livekitHttpUrl: livekitUrl,
    apiKey: decrypt(row.apiKey),
    apiSecret: decrypt(row.apiSecret),
    agentName: row.agentName.trim() || "wacrm-voice",
  };
}
