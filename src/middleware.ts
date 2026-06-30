import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "@/auth.config";
import { ensureAuthUrlEnv } from "@/lib/env/ensure-auth-url";

ensureAuthUrlEnv();

const { auth } = NextAuth({
  ...authConfig,
  trustHost: true,
});

const authPages = ["/login", "/signup", "/forgot-password"];
const protectedPaths = [
  "/dashboard",
  "/inbox",
  "/contacts",
  "/pipelines",
  "/broadcasts",
  "/automations",
  "/agents",
  "/settings",
];

function hasValidSession(authSession: {
  user?: { id?: string; accountId?: string };
} | null) {
  return !!(authSession?.user?.id && authSession.user.accountId);
}

export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;
  const validSession = hasValidSession(req.auth);

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  if (
    validSession &&
    authPages.includes(pathname)
  ) {
    const url = nextUrl.clone();
    const inviteToken = nextUrl.searchParams.get("invite");
    if (
      inviteToken &&
      (pathname === "/login" || pathname === "/signup")
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`;
      url.search = "";
    } else {
      url.pathname = "/dashboard";
      url.search = "";
    }
    return NextResponse.redirect(url);
  }

  if (
    !validSession &&
    protectedPaths.some((path) => pathname.startsWith(path))
  ) {
    const url = nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (
    !validSession &&
    pathname.startsWith("/api/whatsapp/") &&
    !pathname.includes("/webhook")
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/whatsapp/webhook|api/voice/sessions/.+/events|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
