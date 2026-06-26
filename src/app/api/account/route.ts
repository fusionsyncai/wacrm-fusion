// ============================================================
// /api/account
// ============================================================

import { NextResponse } from "next/server";

import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    return NextResponse.json({
      account: ctx.account,
      role: ctx.role,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const MAX_NAME_LEN = 80;

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:rename:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; default_currency?: unknown }
      | null;
    const rawName = body?.name;
    const rawCurrency = body?.default_currency;

    if (rawCurrency !== undefined) {
      if (typeof rawCurrency !== "string" || rawCurrency.trim().length === 0) {
        return NextResponse.json(
          { error: "'default_currency' must be a non-empty string" },
          { status: 400 },
        );
      }
      const account = await prisma.account.update({
        where: { id: ctx.accountId },
        data: { defaultCurrency: rawCurrency.trim() },
        select: { id: true, name: true, defaultCurrency: true },
      });
      return NextResponse.json({
        account: {
          id: account.id,
          name: account.name,
          default_currency: account.defaultCurrency,
        },
      });
    }

    if (typeof rawName !== "string") {
      return NextResponse.json(
        { error: "'name' must be a string" },
        { status: 400 },
      );
    }

    const name = rawName.trim();
    if (name.length === 0) {
      return NextResponse.json(
        { error: "Account name cannot be empty" },
        { status: 400 },
      );
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Account name must be ${MAX_NAME_LEN} characters or fewer` },
        { status: 400 },
      );
    }

    const account = await prisma.account.update({
      where: { id: ctx.accountId },
      data: { name },
      select: { id: true, name: true },
    });

    return NextResponse.json({ account });
  } catch (err) {
    return toErrorResponse(err);
  }
}
