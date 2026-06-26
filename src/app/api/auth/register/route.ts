import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";

import { verifySignupOtp } from "@/lib/auth/signup-otp";
import { prisma } from "@/lib/prisma";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  otp: z.string().regex(/^\d{6}$/, "OTP must be a 6-digit code"),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? "Invalid input";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase().trim();

    const verifyLimit = checkRateLimit(
      `signup-verify:email:${email}`,
      RATE_LIMITS.signupVerify,
    );
    if (!verifyLimit.success) return rateLimitResponse(verifyLimit);

    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }

    const otpValid = await verifySignupOtp(email, parsed.data.otp);
    if (!otpValid) {
      return NextResponse.json(
        { error: "Invalid or expired verification code" },
        { status: 400 },
      );
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const accountName =
      parsed.data.name.trim() || email.split("@")[0] || "My account";

    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: parsed.data.name,
          passwordHash,
          emailVerified: new Date(),
        },
      });

      const account = await tx.account.create({
        data: {
          name: accountName,
          ownerUserId: user.id,
        },
      });

      await tx.profile.create({
        data: {
          userId: user.id,
          fullName: parsed.data.name,
          email,
          accountId: account.id,
          accountRole: "owner",
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[register] failed:", err);
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
