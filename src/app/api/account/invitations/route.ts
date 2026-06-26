// ============================================================
// /api/account/invitations
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  clampExpiryDays,
  generateInviteToken,
  inviteExpiresAt,
  inviteUrl,
} from "@/lib/auth/invitations";
import { isAccountRole } from "@/lib/auth/roles";
import { serializeAccountInvitation } from "@/lib/db/api-serialize";
import { prisma } from "@/lib/prisma";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

import {
  firstHeaderValue,
  requestOrigin,
  safeRequestUrl,
} from "@/lib/http/forwarded";

function parseAllowedHosts(): readonly string[] | null {
  const raw = process.env.ALLOWED_INVITE_HOSTS?.trim();
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

function isHostAllowed(
  hostname: string,
  allowList: readonly string[] | null,
): boolean {
  if (!allowList) return true;
  return allowList.includes(hostname.toLowerCase());
}

function getBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const allowList = parseAllowedHosts();
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const origin = requestOrigin(request);
  if (forwardedHost && origin && isHostAllowed(forwardedHost, allowList)) {
    return origin;
  }

  const host = firstHeaderValue(request.headers.get("host"));
  if (host && isHostAllowed(host, allowList)) {
    const reqProto = safeRequestUrl(request).protocol.replace(":", "");
    return `${reqProto}://${host}`;
  }

  if (allowList && (forwardedHost || host)) {
    console.warn(
      "[POST /api/account/invitations] rejected non-allow-listed host:",
      { forwardedHost, host, allowList },
    );
  } else {
    console.warn(
      "[POST /api/account/invitations] could not derive base URL from request; falling back to marketing domain",
    );
  }
  return "https://wacrm.tech";
}

const MAX_LABEL_LEN = 80;

export async function GET() {
  try {
    const ctx = await requireRole("admin");
    const now = new Date();

    const rows = await prisma.accountInvitation.findMany({
      where: {
        accountId: ctx.accountId,
        acceptedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      invitations: rows.map((row) => serializeAccountInvitation(row)),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:inviteCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { role?: unknown; expiresInDays?: unknown; label?: unknown }
      | null;

    const role = body?.role;
    if (!isAccountRole(role) || role === "owner") {
      return NextResponse.json(
        { error: "'role' must be one of admin, agent, viewer" },
        { status: 400 },
      );
    }

    const expiresInDaysRaw = body?.expiresInDays;
    const expiresInDays =
      typeof expiresInDaysRaw === "number" ? expiresInDaysRaw : undefined;
    const expiryDays = clampExpiryDays(expiresInDays);
    const expiresAt = inviteExpiresAt(expiryDays);

    let label: string | null = null;
    if (typeof body?.label === "string") {
      const trimmed = body.label.trim();
      if (trimmed.length > MAX_LABEL_LEN) {
        return NextResponse.json(
          { error: `Label must be ${MAX_LABEL_LEN} characters or fewer` },
          { status: 400 },
        );
      }
      label = trimmed === "" ? null : trimmed;
    }

    const { token, hash } = generateInviteToken();

    const data = await prisma.accountInvitation.create({
      data: {
        accountId: ctx.accountId,
        tokenHash: hash,
        role,
        createdByUserId: ctx.userId,
        label,
        expiresAt,
      },
      select: {
        id: true,
        role: true,
        label: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json(
      {
        invitation: {
          id: data.id,
          role: data.role,
          label: data.label,
          expires_at: data.expiresAt.toISOString(),
          created_at: data.createdAt.toISOString(),
        },
        token,
        url: inviteUrl(token, getBaseUrl(request)),
        expiresInDays: expiryDays,
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
