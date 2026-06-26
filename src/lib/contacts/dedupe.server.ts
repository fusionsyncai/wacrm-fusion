import "server-only";

import { prisma } from "@/lib/prisma";
import { normalizePhone, phonesMatch } from "@/lib/whatsapp/phone-utils";

import type { ExistingContact } from "./dedupe";

export type { ExistingContact } from "./dedupe";

export async function findExistingContact(
  accountId: string,
  phone: string,
): Promise<ExistingContact | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;

  const data = await prisma.contact.findMany({
    where: {
      accountId,
      phone: { contains: suffix },
    },
  });

  return data.find((c) => phonesMatch(c.phone, phone)) ?? null;
}
