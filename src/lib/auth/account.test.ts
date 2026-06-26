import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    profile: { findUnique: vi.fn() },
    account: { findUnique: vi.fn() },
  },
}));

const { auth } = await import("@/auth");
const { prisma } = await import("@/lib/prisma");
const { getCurrentAccount, UnauthorizedError, ForbiddenError } = await import(
  "./account"
);

afterEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentAccount", () => {
  it("resolves context via profile and account lookups", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", accountId: "acct-1", accountRole: "owner" },
    } as never);
    vi.mocked(prisma.profile.findUnique).mockResolvedValue({
      accountId: "acct-1",
      accountRole: "owner",
    } as never);
    vi.mocked(prisma.account.findUnique).mockResolvedValue({
      id: "acct-1",
      name: "Acme",
    } as never);

    const ctx = await getCurrentAccount();

    expect(ctx).toMatchObject({
      userId: "user-1",
      accountId: "acct-1",
      role: "owner",
      account: { id: "acct-1", name: "Acme" },
    });
  });

  it("throws UnauthorizedError when there is no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(getCurrentAccount()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a profile not linked to an account", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", accountId: "acct-1", accountRole: "owner" },
    } as never);
    vi.mocked(prisma.profile.findUnique).mockResolvedValue(null);

    await expect(getCurrentAccount()).rejects.toThrow(
      "Profile is not linked to an account",
    );
  });

  it("rejects an account_id that resolves to no account row", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", accountId: "acct-1", accountRole: "viewer" },
    } as never);
    vi.mocked(prisma.profile.findUnique).mockResolvedValue({
      accountId: "acct-1",
      accountRole: "viewer",
    } as never);
    vi.mocked(prisma.account.findUnique).mockResolvedValue(null);

    await expect(getCurrentAccount()).rejects.toThrow(
      "Profile is not linked to an account",
    );
  });
});
