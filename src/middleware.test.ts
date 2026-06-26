import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let mockAuth: { user?: { id?: string; accountId?: string } } | null = null;

vi.mock("@/auth.config", () => ({
  authConfig: {
    pages: { signIn: "/login" },
    session: { strategy: "jwt" },
    providers: [],
    callbacks: {},
  },
}));

vi.mock("next-auth", () => ({
  default: () => ({
    auth: (
      handler: (req: {
        auth: typeof mockAuth;
        nextUrl: URL;
      }) => Response | Promise<Response>,
    ) => {
      return (req: NextRequest) =>
        handler({
          auth: mockAuth,
          nextUrl: req.nextUrl,
        });
    },
  }),
}));

const middleware = (await import("./middleware")).default;

beforeEach(() => {
  mockAuth = null;
});

afterEach(() => vi.clearAllMocks());

async function runMiddleware(url: string) {
  const res = await middleware(new NextRequest(url), {} as never);
  return res as Response;
}

describe("middleware — NextAuth session routing", () => {
  it("redirects a signed-in user off /login to /dashboard", async () => {
    mockAuth = { user: { id: "user-1", accountId: "acct-1" } };

    const res = await runMiddleware("https://app.test/login");

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  it("redirects an unauthenticated user on /dashboard to /login", async () => {
    mockAuth = null;

    const res = await runMiddleware("https://app.test/dashboard");

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("redirects a signed-in user with an invite token to /join/<token>", async () => {
    mockAuth = { user: { id: "user-1", accountId: "acct-1" } };

    const res = await runMiddleware("https://app.test/login?invite=abc123");

    expect(res.headers.get("location")).toContain("/join/abc123");
  });

  it("passes through for a signed-in user on a protected page", async () => {
    mockAuth = { user: { id: "user-1", accountId: "acct-1" } };

    const res = await runMiddleware("https://app.test/dashboard");

    expect(res.headers.get("location")).toBeNull();
  });
});
