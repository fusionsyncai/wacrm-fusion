import "server-only";

import { Resend } from "resend";

function requireResendConfig(): { apiKey: string; from: string } {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RESEND_FROM?.trim();
  if (!apiKey || !from) {
    throw new Error(
      "Email is not configured. Set RESEND_API_KEY and RESEND_FROM in your environment.",
    );
  }
  return { apiKey, from };
}

export async function sendSignupOtpEmail(
  to: string,
  code: string,
  name?: string,
): Promise<void> {
  const { apiKey, from } = requireResendConfig();
  const resend = new Resend(apiKey);
  const greeting = name?.trim() ? `Hi ${name.trim()},` : "Hi,";

  const { error } = await resend.emails.send({
    from,
    to,
    subject: `${code} is your verification code`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <p style="color: #374151; font-size: 16px;">${greeting}</p>
        <p style="color: #374151; font-size: 16px;">
          Use this code to complete your signup:
        </p>
        <p style="font-size: 32px; font-weight: 700; letter-spacing: 0.25em; color: #111827; margin: 24px 0;">
          ${code}
        </p>
        <p style="color: #6b7280; font-size: 14px;">
          This code expires in 10 minutes. If you did not request this, you can ignore this email.
        </p>
      </div>
    `,
    text: `${greeting}\n\nYour verification code is: ${code}\n\nThis code expires in 10 minutes.`,
  });

  if (error) {
    throw new Error(error.message || "Failed to send verification email");
  }
}
