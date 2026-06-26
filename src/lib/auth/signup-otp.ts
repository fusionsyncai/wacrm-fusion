import "server-only";

import bcrypt from "bcryptjs";
import crypto from "crypto";

import { prisma } from "@/lib/prisma";

const OTP_TTL_MS = 10 * 60 * 1000;
const SIGNUP_IDENTIFIER_PREFIX = "signup:";

export function signupOtpIdentifier(email: string): string {
  return `${SIGNUP_IDENTIFIER_PREFIX}${email.toLowerCase().trim()}`;
}

export function generateSignupOtpCode(): string {
  return crypto.randomInt(100_000, 1_000_000).toString();
}

export async function storeSignupOtp(email: string, code: string): Promise<void> {
  const identifier = signupOtpIdentifier(email);
  const token = await bcrypt.hash(code, 10);
  const expires = new Date(Date.now() + OTP_TTL_MS);

  await prisma.verificationToken.deleteMany({ where: { identifier } });
  await prisma.verificationToken.create({
    data: { identifier, token, expires },
  });
}

export async function verifySignupOtp(
  email: string,
  code: string,
): Promise<boolean> {
  const identifier = signupOtpIdentifier(email);
  const row = await prisma.verificationToken.findFirst({
    where: { identifier },
    orderBy: { expires: "desc" },
  });

  if (!row || row.expires.getTime() < Date.now()) {
    return false;
  }

  const valid = await bcrypt.compare(code, row.token);
  if (!valid) return false;

  await prisma.verificationToken.deleteMany({ where: { identifier } });
  return true;
}
