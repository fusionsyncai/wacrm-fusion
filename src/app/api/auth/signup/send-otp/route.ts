import { NextResponse } from "next/server";
import { z } from "zod";

import {
  generateSignupOtpCode,
  storeSignupOtp,
} from "@/lib/auth/signup-otp";
import { sendSignupOtpEmail } from "@/lib/email/resend";
import { getClientIp } from "@/lib/http/client-ip";
import { prisma } from "@/lib/prisma";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const sendOtpSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = sendOtpSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    const email = parsed.data.email.toLowerCase().trim();
    const ip = getClientIp(request);

    const emailLimit = checkRateLimit(
      `signup-otp:email:${email}`,
      RATE_LIMITS.signupOtp,
    );
    if (!emailLimit.success) return rateLimitResponse(emailLimit);

    const ipLimit = checkRateLimit(
      `signup-otp:ip:${ip}`,
      RATE_LIMITS.signupOtpIp,
    );
    if (!ipLimit.success) return rateLimitResponse(ipLimit);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }

    const code = generateSignupOtpCode();
    await storeSignupOtp(email, code);
    await sendSignupOtpEmail(email, code, parsed.data.name);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to send verification code";
    console.error("[signup/send-otp] failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
