// ============================================================
// POST /api/invitations/[token]/redeem
// ============================================================

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  hashInviteToken,
  redeemInvitation,
} from "@/lib/auth/invitations";
import { SqlStateError } from "@/lib/db/sql-state-error";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

function rpcErrorToResponse(err: SqlStateError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  if (err.code === "23505") {
    return NextResponse.json({ error: err.message }, { status: 409 });
  }
  console.error("[redeem] unexpected error:", err);
  return NextResponse.json(
    { error: "Failed to redeem invitation" },
    { status: 500 },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`redeem:${ip}`, RATE_LIMITS.invitationRedeem);
  if (!limit.success) return rateLimitResponse(limit);

  const { token } = await params;
  if (!token || typeof token !== "string") {
    return NextResponse.json(
      { error: "Missing invitation token" },
      { status: 400 },
    );
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const accountId = await redeemInvitation(
      userId,
      hashInviteToken(token),
    );
    return NextResponse.json({ ok: true, accountId });
  } catch (err) {
    if (err instanceof SqlStateError) return rpcErrorToResponse(err);
    console.error("[redeem] error:", err);
    return NextResponse.json(
      { error: "Failed to redeem invitation" },
      { status: 500 },
    );
  }
}
