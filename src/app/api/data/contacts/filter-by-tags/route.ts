import { NextResponse } from "next/server";
import type { Prisma } from "@/generated/prisma/client";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { serializeContact } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = await request.json().catch(() => null);
    const tagIds = Array.isArray(body?.tag_ids) ? (body.tag_ids as string[]) : [];
    const search = typeof body?.search === "string" ? body.search.trim() : "";
    const limit = Math.min(100, Math.max(1, Number(body?.limit ?? 25)));
    const offset = Math.max(0, Number(body?.offset ?? 0));

    if (tagIds.length === 0) {
      return NextResponse.json({ error: "tag_ids required" }, { status: 400 });
    }

    const where: Prisma.ContactWhereInput = {
      accountId: ctx.accountId,
      contactTags: { some: { tagId: { in: tagIds } } },
    };
    if (search) {
      where.AND = [
        {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { phone: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        },
      ];
    }

    const [totalCount, contacts] = await Promise.all([
      prisma.contact.count({ where }),
      prisma.contact.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: offset,
        take: limit,
      }),
    ]);

    return NextResponse.json({
      rows: contacts.map((contact) => ({
        contact: serializeContact(contact),
        total_count: totalCount,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
