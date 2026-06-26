// ============================================================
// Server-side account context — for API routes and server
// components. Reads the caller's profile + account via Prisma
// and verifies role on demand.
// ============================================================

import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasMinRole, isAccountRole, type AccountRole } from "./roles";

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[toErrorResponse] uncategorized error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export interface AccountContext {
  userId: string;
  accountId: string;
  role: AccountRole;
  account: { id: string; name: string };
}

export async function getCurrentAccount(): Promise<AccountContext> {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    throw new UnauthorizedError();
  }

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { accountId: true, accountRole: true },
  });

  if (!profile?.accountId || !profile.accountRole) {
    throw new ForbiddenError("Profile is not linked to an account");
  }

  if (!isAccountRole(profile.accountRole)) {
    throw new ForbiddenError(`Unknown account role: ${profile.accountRole}`);
  }

  const account = await prisma.account.findUnique({
    where: { id: profile.accountId },
    select: { id: true, name: true },
  });

  if (!account) {
    throw new ForbiddenError("Profile is not linked to an account");
  }

  return {
    userId,
    accountId: profile.accountId,
    role: profile.accountRole,
    account: { id: account.id, name: account.name },
  };
}

export async function requireRole(min: AccountRole): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!hasMinRole(ctx.role, min)) {
    throw new ForbiddenError(`This action requires the '${min}' role or higher`);
  }
  return ctx;
}
