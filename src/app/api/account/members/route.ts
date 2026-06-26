// ============================================================
// GET /api/account/members
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers, isAccountRole } from "@/lib/auth/roles";
import { prisma } from "@/lib/prisma";
import type { AccountMember } from "@/types";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const profiles = await prisma.profile.findMany({
      where: { accountId: ctx.accountId },
      select: {
        userId: true,
        fullName: true,
        email: true,
        avatarUrl: true,
        accountRole: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const canSeeEmails = canManageMembers(ctx.role);

    const members: AccountMember[] = profiles.flatMap((row) => {
      if (!isAccountRole(row.accountRole)) return [];
      return [
        {
          user_id: row.userId,
          full_name: row.fullName ?? "",
          email: canSeeEmails ? row.email : null,
          avatar_url: row.avatarUrl,
          role: row.accountRole,
          joined_at: row.createdAt.toISOString(),
        },
      ];
    });

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}
