// ============================================================
// Public API authentication — resolve a request's API key into an
// account context.
// ============================================================

import {
  findActiveKeyByHash,
  touchLastUsed,
} from "@/lib/api-keys/store";
import { hashApiKey, looksLikeApiKey } from "@/lib/api-keys/keys";
import { hasScope, type ApiScope } from "@/lib/api-keys/scopes";
import { forbidden, rateLimited, unauthorized } from "@/lib/api/v1/respond";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

export interface ApiKeyContext {
  /** Discriminant — lets shared logic tell key auth from cookie auth. */
  authType: "api_key";
  /** The account this key belongs to. */
  accountId: string;
  /** The key row id — for audit logging and the rate-limit bucket. */
  keyId: string;
  /** Scopes granted to this key. */
  scopes: string[];
  /** Who minted the key (null if that user was later removed). */
  createdBy: string | null;
}

function extractKey(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const value = header.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : header.trim();
  return value.length > 0 ? value : null;
}

export async function requireApiKey(
  request: Request,
  scope?: ApiScope,
): Promise<ApiKeyContext> {
  const presented = extractKey(request);
  if (!presented || !looksLikeApiKey(presented)) {
    throw unauthorized();
  }

  const row = await findActiveKeyByHash(hashApiKey(presented));
  if (!row) {
    throw unauthorized();
  }

  const limit = checkRateLimit(`apikey:${row.id}`, RATE_LIMITS.publicApi);
  if (!limit.success) {
    throw rateLimited(limit);
  }

  if (scope && !hasScope(row.scopes, scope)) {
    throw forbidden(`This API key is missing the '${scope}' scope`);
  }

  touchLastUsed(row.id);

  return {
    authType: "api_key",
    accountId: row.account_id,
    keyId: row.id,
    scopes: row.scopes,
    createdBy: row.created_by,
  };
}
