import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { decrypt } from "@/lib/whatsapp/encryption";
import { sendTemplateMessage } from "@/lib/whatsapp/meta-api";
import type { SendTimeParams } from "@/lib/whatsapp/template-send-builder";
import { isMessageTemplate } from "@/lib/whatsapp/template-row-guard";
import { serializeMessageTemplate } from "@/lib/db/api-serialize";
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from "@/lib/whatsapp/phone-utils";

interface BroadcastResult {
  phone: string;
  status: "sent" | "failed";
  whatsapp_message_id?: string;
  error?: string;
}

interface NewRecipient {
  phone: string;
  params?: string[];
  messageParams?: SendTimeParams;
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    const limit = checkRateLimit(`broadcast:${ctx.userId}`, RATE_LIMITS.broadcast);
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json();
    const {
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
    } = body;

    let recipients: NewRecipient[];
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients;
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params) ? template_params : [];
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }));
    } else {
      return NextResponse.json(
        {
          error:
            "Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array",
        },
        { status: 400 },
      );
    }

    if (!template_name) {
      return NextResponse.json(
        { error: "template_name is required" },
        { status: 400 },
      );
    }

    const config = await prisma.whatsappConfig.findUnique({
      where: { accountId: ctx.accountId },
    });

    if (!config) {
      return NextResponse.json(
        {
          error:
            "WhatsApp not configured. Please set up your WhatsApp integration first.",
        },
        { status: 400 },
      );
    }

    const accessToken = decrypt(config.accessToken);

    const rawTemplateRow = await prisma.messageTemplate.findFirst({
      where: {
        accountId: ctx.accountId,
        name: template_name,
        language: template_language || "en_US",
      },
    });

    const serialized = rawTemplateRow
      ? serializeMessageTemplate(rawTemplateRow)
      : null;
    if (serialized && !isMessageTemplate(serialized)) {
      return NextResponse.json(
        {
          error:
            "Template row is malformed locally — run \"Sync from Meta\" in Settings to repair it before broadcasting.",
        },
        { status: 500 },
      );
    }
    const templateRow = serialized && isMessageTemplate(serialized) ? serialized : null;

    const results: BroadcastResult[] = [];
    let sentCount = 0;
    let failedCount = 0;

    for (const recipient of recipients) {
      const sanitized = sanitizePhoneForMeta(recipient.phone);

      if (!isValidE164(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: "failed",
          error: "Invalid phone number format",
        });
        failedCount++;
        continue;
      }

      const variants = phoneVariants(sanitized);
      let sentMessageId: string | null = null;
      let lastError: string | null = null;

      for (const variant of variants) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: config.phoneNumberId,
            accessToken,
            to: variant,
            templateName: template_name,
            language: template_language || "en_US",
            template: templateRow ?? undefined,
            messageParams: recipient.messageParams,
            params: recipient.params ?? [],
          });
          sentMessageId = result.messageId;
          lastError = null;
          break;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          if (!isRecipientNotAllowedError(errorMessage)) {
            lastError = errorMessage;
            break;
          }
          lastError = errorMessage;
        }
      }

      if (sentMessageId) {
        results.push({
          phone: recipient.phone,
          status: "sent",
          whatsapp_message_id: sentMessageId,
        });
        sentCount++;
      } else {
        console.error(`Failed to send broadcast to ${recipient.phone}:`, lastError);
        results.push({
          phone: recipient.phone,
          status: "failed",
          error: lastError || "Unknown error",
        });
        failedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "UnauthorizedError" || err.name === "ForbiddenError")
    ) {
      return toErrorResponse(err);
    }
    console.error("Error in WhatsApp broadcast POST:", err);
    return NextResponse.json({ error: "Failed to process broadcast" }, { status: 500 });
  }
}
