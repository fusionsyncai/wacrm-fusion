import { NextResponse } from "next/server";

import { getSessionUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { uploadAvatar } from "@/lib/storage/server-upload";

export async function GET() {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await prisma.profile.findUnique({
    where: { userId: sessionUser.id },
    select: {
      id: true,
      fullName: true,
      email: true,
      avatarUrl: true,
      role: true,
      betaFeatures: true,
      accountId: true,
      accountRole: true,
    },
  });

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const account = await prisma.account.findUnique({
    where: { id: profile.accountId },
    select: { id: true, name: true, defaultCurrency: true },
  });

  return NextResponse.json({
    user: {
      id: sessionUser.id,
      email: sessionUser.email,
      name: sessionUser.name,
    },
    profile: {
      id: profile.id,
      full_name: profile.fullName,
      email: profile.email,
      avatar_url: profile.avatarUrl,
      role: profile.role,
      beta_features: profile.betaFeatures,
      account_id: profile.accountId,
      account_role: profile.accountRole,
    },
    account: account
      ? {
          id: account.id,
          name: account.name,
          default_currency: account.defaultCurrency ?? DEFAULT_CURRENCY,
        }
      : null,
  });
}

export async function PATCH(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const fullName = form.get("full_name");
    const avatarFile = form.get("avatar");

    if (typeof fullName !== "string" || !fullName.trim()) {
      return NextResponse.json({ error: "full_name is required" }, { status: 400 });
    }

    let avatarUrl: string | null | undefined;
    if (avatarFile === "null") {
      avatarUrl = null;
    } else if (avatarFile instanceof File && avatarFile.size > 0) {
      avatarUrl = await uploadAvatar(sessionUser.id, avatarFile);
    }

    const profile = await prisma.profile.update({
      where: { userId: sessionUser.id },
      data: {
        fullName: fullName.trim(),
        ...(avatarUrl !== undefined ? { avatarUrl } : {}),
      },
    });

    return NextResponse.json({
      profile: {
        id: profile.id,
        full_name: profile.fullName,
        email: profile.email,
        avatar_url: profile.avatarUrl,
      },
    });
  }

  const body = (await request.json().catch(() => null)) as {
    full_name?: unknown;
    avatar_url?: unknown;
  } | null;

  if (!body || typeof body.full_name !== "string" || !body.full_name.trim()) {
    return NextResponse.json({ error: "full_name is required" }, { status: 400 });
  }

  const profile = await prisma.profile.update({
    where: { userId: sessionUser.id },
    data: {
      fullName: body.full_name.trim(),
      ...(body.avatar_url === null ? { avatarUrl: null } : {}),
    },
  });

  return NextResponse.json({
    profile: {
      id: profile.id,
      full_name: profile.fullName,
      email: profile.email,
      avatar_url: profile.avatarUrl,
    },
  });
}
