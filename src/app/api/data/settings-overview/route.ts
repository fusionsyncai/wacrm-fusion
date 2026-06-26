import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const [
      approvedTemplates,
      pendingTemplates,
      tagCount,
      customFieldCount,
      whatsappConfig,
    ] = await Promise.all([
      prisma.messageTemplate.count({
        where: { accountId: ctx.accountId, status: "APPROVED" },
      }),
      prisma.messageTemplate.count({
        where: { accountId: ctx.accountId, status: "PENDING" },
      }),
      prisma.tag.count({ where: { accountId: ctx.accountId } }),
      prisma.customField.count({ where: { accountId: ctx.accountId } }),
      prisma.whatsappConfig.findUnique({
        where: { accountId: ctx.accountId },
        select: { status: true, phoneNumberId: true },
      }),
    ]);

    return NextResponse.json({
      approved_templates: approvedTemplates,
      pending_templates: pendingTemplates,
      tag_count: tagCount,
      custom_field_count: customFieldCount,
      whatsapp_connected: whatsappConfig?.status === "connected",
      whatsapp_phone_number_id: whatsappConfig?.phoneNumberId ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
