import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { serializeProfile } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const profiles = await prisma.profile.findMany({
      where: { accountId: ctx.accountId },
      orderBy: { fullName: "asc" },
    });
    return NextResponse.json({ profiles: profiles.map(serializeProfile) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
