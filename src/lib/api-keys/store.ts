// ============================================================
// API key store — the *auth-path* data access for public API keys.
// ============================================================

import { prisma } from "@/lib/prisma";

/** Shape of an `api_keys` row as the auth path consumes it. */
export interface ApiKeyRow {
  id: string;
  account_id: string;
  created_by: string | null;
  name: string;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
}

export async function findActiveKeyByHash(
  hash: string,
): Promise<ApiKeyRow | null> {
  const row = await prisma.apiKey.findUnique({
    where: { keyHash: hash },
    select: {
      id: true,
      accountId: true,
      createdBy: true,
      name: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  if (!row) return null;
  if (row.revokedAt) return null;
  if (row.expiresAt instanceof Date && row.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return {
    id: row.id,
    account_id: row.accountId,
    created_by: row.createdBy,
    name: row.name,
    scopes: row.scopes,
    expires_at: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : null,
    revoked_at: null,
  };
}

export async function getAccountName(accountId: string): Promise<string | null> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { name: true },
  });
  return account?.name ?? null;
}

export function touchLastUsed(id: string): void {
  void prisma.apiKey
    .update({
      where: { id },
      data: { lastUsedAt: new Date() },
    })
    .catch((err) => {
      console.warn("[api-keys/store] last_used_at bump failed:", err);
    });
}
