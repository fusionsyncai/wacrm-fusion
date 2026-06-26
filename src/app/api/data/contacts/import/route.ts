import { NextResponse } from "next/server";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  dedupeByPhone,
  isUniqueViolation,
  normalizeKey,
} from "@/lib/contacts/dedupe";
import {
  assignImportedContactTags,
  resolveImportTagIds,
  type ContactTagAssignment,
} from "@/lib/contacts/resolve-import-tags";
import { serializeContact } from "@/lib/db/serialize-entities";
import { prisma } from "@/lib/prisma";

interface ImportRow {
  phone: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
  tag_names?: string[];
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const body = await request.json().catch(() => null);
    const rows = Array.isArray(body?.rows) ? (body.rows as ImportRow[]) : [];
    const canCreateTags = body?.can_create_tags === true;

    if (rows.length === 0) {
      return NextResponse.json({ error: "rows required" }, { status: 400 });
    }

    const { unique, duplicates: inFileDupes } = dedupeByPhone(
      rows.map((r) => ({
        phone: r.phone,
        name: r.name ?? undefined,
        email: r.email ?? undefined,
        company: r.company ?? undefined,
        tagNames: r.tag_names ?? [],
      })),
    );

    const existingRows = await prisma.contact.findMany({
      where: { accountId: ctx.accountId },
      select: { phone: true },
    });
    const existing = new Set(
      existingRows
        .map((r) => normalizeKey(r.phone))
        .filter((p): p is string => !!p),
    );

    let skipped = inFileDupes;
    const toInsert = unique.filter((row) => {
      if (existing.has(normalizeKey(row.phone))) {
        skipped++;
        return false;
      }
      return true;
    });

    const allTagNames = toInsert.flatMap((row) => row.tagNames ?? []);
    let tagIdByKey = new Map<string, string>();
    let skippedNames: string[] = [];
    if (allTagNames.length > 0) {
      ({ tagIdByKey, skippedNames } = await resolveImportTagIds({
        accountId: ctx.accountId,
        userId: ctx.userId,
        tagNames: allTagNames,
        canCreateTags,
      }));
    }

    let imported = 0;
    let failed = 0;
    const tagAssignments: ContactTagAssignment[] = [];
    const chunkSize = 50;

    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize);

      for (const source of chunk) {
        try {
          const contact = await prisma.contact.create({
            data: {
              userId: ctx.userId,
              accountId: ctx.accountId,
              phone: source.phone,
              name: source.name?.trim() || null,
              email: source.email?.trim() || null,
              company: source.company?.trim() || null,
            },
          });
          imported++;
          if ((source.tagNames ?? []).length > 0) {
            tagAssignments.push({
              contactId: contact.id,
              tagNames: source.tagNames ?? [],
            });
          }
        } catch (err) {
          if (isUniqueViolation(err)) skipped++;
          else failed++;
        }
      }
    }

    let tagsAssigned = 0;
    try {
      tagsAssigned = await assignImportedContactTags(tagAssignments, tagIdByKey);
    } catch {
      // Non-fatal — contacts may have imported successfully.
    }

    return NextResponse.json({
      imported,
      skipped,
      failed,
      tags_assigned: tagsAssigned,
      skipped_tag_names: skippedNames,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
