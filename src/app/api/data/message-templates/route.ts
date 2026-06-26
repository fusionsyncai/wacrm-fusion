import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { serializeMessageTemplate } from "@/lib/db/api-serialize";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const templates = await prisma.messageTemplate.findMany({
      where: {
        accountId: ctx.accountId,
        ...(status ? { status: status as never } : {}),
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json({ templates: templates.map(serializeMessageTemplate) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = await request.json().catch(() => null);
    if (!body?.id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const existing = await prisma.messageTemplate.findFirst({
      where: { id: body.id, accountId: ctx.accountId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const template = await prisma.messageTemplate.update({
      where: { id: body.id },
      data: {
        ...(typeof body?.name === "string" ? { name: body.name } : {}),
        ...(body?.category ? { category: body.category } : {}),
        ...(typeof body?.language === "string" ? { language: body.language } : {}),
        ...(body?.header_type !== undefined ? { headerType: body.header_type } : {}),
        ...(body?.header_content !== undefined ? { headerContent: body.header_content } : {}),
        ...(typeof body?.body_text === "string" ? { bodyText: body.body_text } : {}),
        ...(body?.footer_text !== undefined ? { footerText: body.footer_text } : {}),
        ...(body?.buttons !== undefined ? { buttons: body.buttons } : {}),
        ...(body?.sample_values !== undefined ? { sampleValues: body.sample_values } : {}),
        ...(body?.status ? { status: body.status } : {}),
        ...(body?.header_media_url !== undefined
          ? { headerMediaUrl: body.header_media_url }
          : {}),
      },
    });

    return NextResponse.json({ template: serializeMessageTemplate(template) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = await request.json().catch(() => null);
    if (!body?.id) {
      return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const existing = await prisma.messageTemplate.findFirst({
      where: { id: body.id, accountId: ctx.accountId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.messageTemplate.delete({ where: { id: body.id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
