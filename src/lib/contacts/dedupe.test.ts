import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  dedupeByPhone,
  isExactMatch,
  isUniqueViolation,
  normalizeKey,
} from "./dedupe";
import { findExistingContact } from "./dedupe.server";

const findMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    contact: {
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}));

describe("normalizeKey", () => {
  it("strips every non-digit", () => {
    expect(normalizeKey("+1 (555) 123-4567")).toBe("15551234567");
    expect(normalizeKey("15551234567")).toBe("15551234567");
  });

  it("collapses different formats of the same number to one key", () => {
    expect(normalizeKey("+44 7911 123456")).toBe(normalizeKey("447911123456"));
  });
});

describe("isExactMatch", () => {
  it("treats different formatting of the same digits as exact", () => {
    expect(isExactMatch({ id: "1", phone: "+1 555-123-4567" }, "15551234567")).toBe(
      true,
    );
  });

  it("is false for a trunk-variant (fuzzy) match", () => {
    expect(isExactMatch({ id: "1", phone: "37063949836" }, "370063949836")).toBe(
      false,
    );
  });
});

describe("isUniqueViolation", () => {
  it("detects Postgres 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });
  it("detects Prisma P2002", () => {
    expect(isUniqueViolation({ code: "P2002" })).toBe(true);
  });
  it("is false for other errors / non-objects", () => {
    expect(isUniqueViolation({ code: "23502" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("boom")).toBe(false);
  });
});

describe("dedupeByPhone", () => {
  it("keeps the first occurrence and counts in-file duplicates", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "+1 555-1111", name: "A" },
      { phone: "15551111", name: "B" },
      { phone: "+1 555-2222", name: "C" },
    ]);
    expect(unique.map((r) => r.name)).toEqual(["A", "C"]);
    expect(duplicates).toBe(1);
  });

  it("drops rows with no digits", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "   " },
      { phone: "+1 555-3333" },
    ]);
    expect(unique).toHaveLength(1);
    expect(duplicates).toBe(1);
  });
});

describe("findExistingContact", () => {
  beforeEach(() => {
    findMany.mockReset();
  });

  it("returns a trunk-variant match via phonesMatch", async () => {
    findMany.mockResolvedValue([{ id: "c1", phone: "37063949836" }]);
    const hit = await findExistingContact("acct", "+370 063 949 836");
    expect(hit?.id).toBe("c1");
    expect(findMany).toHaveBeenCalledWith({
      where: { accountId: "acct", phone: { contains: "63949836" } },
    });
  });

  it("returns null when no candidate matches", async () => {
    findMany.mockResolvedValue([{ id: "c1", phone: "15559999999" }]);
    const hit = await findExistingContact("acct", "+1 555-123-4567");
    expect(hit).toBeNull();
  });

  it("returns null for an empty phone without querying", async () => {
    expect(await findExistingContact("acct", "   ")).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });
});
