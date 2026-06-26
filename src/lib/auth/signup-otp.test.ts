import { describe, expect, it } from "vitest";

import {
  generateSignupOtpCode,
  signupOtpIdentifier,
} from "@/lib/auth/signup-otp";

describe("signupOtpIdentifier", () => {
  it("normalizes email to lowercase", () => {
    expect(signupOtpIdentifier("User@Example.com")).toBe("signup:user@example.com");
  });
});

describe("generateSignupOtpCode", () => {
  it("returns a 6-digit string", () => {
    const code = generateSignupOtpCode();
    expect(code).toMatch(/^\d{6}$/);
  });
});
