import { auth } from "@/auth";
import type { AccountRole } from "@/generated/prisma/client";

export async function getSessionUser() {
  const session = await auth();
  if (!session?.user?.id || !session.user.accountId || !session.user.accountRole) {
    return null;
  }
  return session.user;
}

export async function requireSessionUser() {
  const user = await getSessionUser();
  if (!user) {
    throw new Error("Unauthorized");
  }
  return user;
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

export type { AccountRole };
