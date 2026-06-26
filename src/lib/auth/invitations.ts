// ============================================================
// Invitation token utilities — pure, server-side, no Supabase.
//
// Why we hash tokens at rest
// --------------------------
// The DB stores only `account_invitations.token_hash` (SHA-256
// of the random token), never the plaintext. A leaked DB snapshot
// (logs, backups, support exports) therefore can't be used to
// redeem invites — the attacker would need the original token,
// which is returned exactly once at creation time.
//
// Why 32 bytes
// ------------
// 32 bytes of CSPRNG entropy is the standard for opaque session-
// style tokens. base64url-encodes to a 43-char string, fits
// comfortably in a URL, and is well past the practical brute-
// force boundary even with SHA-256 collisions (256 bits >> any
// realistic adversary).
//
// Why base64url (not hex)
// -----------------------
// URL-safe and shorter than hex. `crypto.randomBytes(32).toString
// ('base64url')` lands at 43 characters; hex would be 64.
// ============================================================

import { createHash, randomBytes } from "node:crypto";

import type { AccountRole } from "@/generated/prisma/client";
import { SqlStateError } from "@/lib/db/sql-state-error";
import { prisma } from "@/lib/prisma";

/** Default invite link lifetime if the caller doesn't specify. */
export const DEFAULT_INVITE_EXPIRY_DAYS = 7;

/** Hard ceiling on user-supplied `expiresInDays` (1 year). */
export const MAX_INVITE_EXPIRY_DAYS = 365;

export interface GeneratedToken {
  /** Plaintext token — return to the creator ONCE, never persist. */
  token: string;
  /** SHA-256 hex digest of the token. Persist this in the DB. */
  hash: string;
}

/**
 * Generate a fresh invite token + its hash. Call once per invite
 * creation; the plaintext is shown to the admin in the UI and
 * embedded in the shareable link, the hash is stored in
 * `account_invitations.token_hash`.
 */
export function generateInviteToken(): GeneratedToken {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

/**
 * Deterministic SHA-256 of a plaintext token. Used at redeem time
 * to look up the matching `account_invitations` row by `token_hash`.
 * Pure function — same input always produces the same output.
 */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Build the public invite URL the admin will share. The token is
 * carried in the path (not the query) so referrer-policy noise
 * and browser autocomplete don't trip up token preservation.
 *
 * `baseUrl` must NOT have a trailing slash. The function tolerates
 * one anyway (so callers can pass `NEXT_PUBLIC_APP_URL` verbatim
 * without sweating slash hygiene).
 */
export function inviteUrl(token: string, baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return `${trimmed}/join/${token}`;
}

/**
 * Compute the `expires_at` timestamp for a new invite.
 *
 * - Clamps `expiresInDays` to `[1, MAX_INVITE_EXPIRY_DAYS]`.
 * - Falls back to `DEFAULT_INVITE_EXPIRY_DAYS` for missing input.
 * - `now` is injectable so tests don't need timer mocking.
 */
export function inviteExpiresAt(
  expiresInDays: number | undefined,
  now: Date = new Date(),
): Date {
  const days = clampExpiryDays(expiresInDays);
  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() + ms);
}

/** Exposed for tests and for the API route that echoes the clamped value back. */
export function clampExpiryDays(expiresInDays: number | undefined): number {
  if (
    expiresInDays === undefined ||
    !Number.isFinite(expiresInDays) ||
    expiresInDays <= 0
  ) {
    return DEFAULT_INVITE_EXPIRY_DAYS;
  }
  return Math.min(Math.floor(expiresInDays), MAX_INVITE_EXPIRY_DAYS);
}

export type PeekInvitationResult =
  | { ok: true; account_name: string | null; role: AccountRole; expires_at: string }
  | { ok: false; reason: "not_found" | "expired" | "used" };

/** Anonymous invite preview — mirrors `peek_invitation` RPC. */
export async function peekInvitation(
  tokenHash: string,
): Promise<PeekInvitationResult> {
  const inv = await prisma.accountInvitation.findUnique({
    where: { tokenHash },
    include: { account: { select: { name: true } } },
  });

  if (!inv) return { ok: false, reason: "not_found" };
  if (inv.acceptedAt) return { ok: false, reason: "used" };
  if (inv.expiresAt <= new Date()) return { ok: false, reason: "expired" };

  return {
    ok: true,
    account_name: inv.account.name,
    role: inv.role,
    expires_at: inv.expiresAt.toISOString(),
  };
}

async function accountHasDomainData(accountId: string): Promise<boolean> {
  const checks = await Promise.all([
    prisma.contact.count({ where: { accountId } }),
    prisma.conversation.count({ where: { accountId } }),
    prisma.broadcast.count({ where: { accountId } }),
    prisma.automation.count({ where: { accountId } }),
    prisma.flow.count({ where: { accountId } }),
    prisma.pipeline.count({ where: { accountId } }),
    prisma.messageTemplate.count({ where: { accountId } }),
    prisma.tag.count({ where: { accountId } }),
    prisma.customField.count({ where: { accountId } }),
    prisma.contactNote.count({ where: { accountId } }),
    prisma.whatsappConfig.count({ where: { accountId } }),
  ]);
  return checks.some((n) => n > 0);
}

/** Authenticated invite redeem — mirrors `redeem_invitation` RPC. */
export async function redeemInvitation(
  callerUserId: string,
  tokenHash: string,
): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        account_id: string;
        role: AccountRole;
        accepted_at: Date | null;
        expires_at: Date;
      }>
    >`
      SELECT id, account_id, role, accepted_at, expires_at
      FROM account_invitations
      WHERE token_hash = ${tokenHash}
      FOR UPDATE
    `;

    const inv = rows[0];
    if (!inv) {
      throw new SqlStateError("Invitation not found", "22023");
    }
    if (inv.accepted_at) {
      throw new SqlStateError("Invitation has already been redeemed", "22023");
    }
    if (inv.expires_at <= new Date()) {
      throw new SqlStateError("Invitation has expired", "22023");
    }

    const profile = await tx.profile.findUnique({
      where: { userId: callerUserId },
      select: { accountId: true },
    });
    if (!profile?.accountId) {
      throw new SqlStateError("Caller has no profile", "42501");
    }

    const account = await tx.account.findUnique({
      where: { id: profile.accountId },
      select: { ownerUserId: true },
    });
    if (!account) {
      throw new SqlStateError("Caller has no profile", "42501");
    }

    const oldAccountId = profile.accountId;

    if (oldAccountId === inv.account_id) {
      throw new SqlStateError(
        "You are already a member of this account",
        "23505",
      );
    }

    if (account.ownerUserId !== callerUserId) {
      throw new SqlStateError(
        "You are already in a shared account; sign up with a different email to join this one",
        "23505",
      );
    }

    if (await accountHasDomainData(oldAccountId)) {
      throw new SqlStateError(
        "Your account already contains data; sign up with a different email to join this one",
        "23505",
      );
    }

    await tx.profile.update({
      where: { userId: callerUserId },
      data: {
        accountId: inv.account_id,
        accountRole: inv.role,
      },
    });

    await tx.accountInvitation.update({
      where: { id: inv.id },
      data: {
        acceptedAt: new Date(),
        acceptedByUserId: callerUserId,
      },
    });

    await tx.account.delete({ where: { id: oldAccountId } });

    return inv.account_id;
  });
}
