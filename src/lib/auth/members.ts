import { prisma } from "@/lib/prisma";
import { SqlStateError } from "@/lib/db/sql-state-error";
import { hasMinRole, type AccountRole } from "./roles";

export async function setMemberRole(
  callerUserId: string,
  targetUserId: string,
  newRole: AccountRole,
): Promise<void> {
  const caller = await prisma.profile.findUnique({
    where: { userId: callerUserId },
    select: { accountId: true, accountRole: true },
  });

  if (!caller?.accountId) {
    throw new SqlStateError("Caller has no account", "42501");
  }
  if (!hasMinRole(caller.accountRole, "admin")) {
    throw new SqlStateError(
      "This action requires the admin role or higher",
      "42501",
    );
  }
  if (targetUserId === callerUserId) {
    throw new SqlStateError("Cannot change your own role", "22023");
  }

  const target = await prisma.profile.findUnique({
    where: { userId: targetUserId },
    select: { accountId: true, accountRole: true },
  });

  if (!target?.accountId) {
    throw new SqlStateError("Target user not found", "22023");
  }
  if (target.accountId !== caller.accountId) {
    throw new SqlStateError(
      "Target user is not a member of your account",
      "42501",
    );
  }
  if (target.accountRole === "owner") {
    throw new SqlStateError(
      "Use transfer_account_ownership to demote an owner",
      "22023",
    );
  }
  if (newRole === "owner") {
    throw new SqlStateError(
      "Use transfer_account_ownership to promote to owner",
      "22023",
    );
  }

  await prisma.profile.update({
    where: { userId: targetUserId },
    data: { accountRole: newRole },
  });
}

export async function removeAccountMember(
  callerUserId: string,
  targetUserId: string,
): Promise<string> {
  const caller = await prisma.profile.findUnique({
    where: { userId: callerUserId },
    select: { accountId: true, accountRole: true },
  });

  if (!caller?.accountId) {
    throw new SqlStateError("Caller has no account", "42501");
  }
  if (!hasMinRole(caller.accountRole, "admin")) {
    throw new SqlStateError(
      "This action requires the admin role or higher",
      "42501",
    );
  }
  if (targetUserId === callerUserId) {
    throw new SqlStateError(
      "Cannot remove yourself; transfer ownership or leave the account instead",
      "22023",
    );
  }

  const target = await prisma.profile.findUnique({
    where: { userId: targetUserId },
    select: {
      accountId: true,
      accountRole: true,
      fullName: true,
      email: true,
    },
  });

  if (!target?.accountId) {
    throw new SqlStateError("Target user not found", "22023");
  }
  if (target.accountId !== caller.accountId) {
    throw new SqlStateError(
      "Target user is not a member of your account",
      "42501",
    );
  }
  if (target.accountRole === "owner") {
    throw new SqlStateError(
      "Cannot remove the account owner; transfer ownership first",
      "22023",
    );
  }

  const accountName =
    target.fullName.trim() ||
    target.email ||
    "My account";

  return await prisma.$transaction(async (tx) => {
    const newAccount = await tx.account.create({
      data: {
        name: accountName,
        ownerUserId: targetUserId,
      },
    });

    await tx.profile.update({
      where: { userId: targetUserId },
      data: {
        accountId: newAccount.id,
        accountRole: "owner",
      },
    });

    return newAccount.id;
  });
}

export async function transferAccountOwnership(
  callerUserId: string,
  newOwnerUserId: string,
): Promise<void> {
  const caller = await prisma.profile.findUnique({
    where: { userId: callerUserId },
    select: { accountId: true, accountRole: true },
  });

  if (!caller?.accountId) {
    throw new SqlStateError("Caller has no account", "42501");
  }
  if (caller.accountRole !== "owner") {
    throw new SqlStateError(
      "Only the account owner can transfer ownership",
      "42501",
    );
  }
  if (newOwnerUserId === callerUserId) {
    throw new SqlStateError("You are already the owner", "22023");
  }

  const target = await prisma.profile.findUnique({
    where: { userId: newOwnerUserId },
    select: { accountId: true },
  });

  if (!target?.accountId) {
    throw new SqlStateError("Target user not found", "22023");
  }
  if (target.accountId !== caller.accountId) {
    throw new SqlStateError(
      "Target user is not a member of your account",
      "42501",
    );
  }

  await prisma.$transaction([
    prisma.profile.update({
      where: { userId: callerUserId },
      data: { accountRole: "admin" },
    }),
    prisma.profile.update({
      where: { userId: newOwnerUserId },
      data: { accountRole: "owner" },
    }),
    prisma.account.update({
      where: { id: caller.accountId },
      data: { ownerUserId: newOwnerUserId },
    }),
  ]);
}
