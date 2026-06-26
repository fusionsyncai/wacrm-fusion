import type { NextAuthConfig } from "next-auth";

import type { AccountRole } from "@/generated/prisma/client";

/** Edge-safe auth config used by middleware. Database access lives in auth.ts only. */
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.accountId = user.accountId;
        token.accountRole = user.accountRole;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.accountId = token.accountId as string;
        session.user.accountRole = token.accountRole as AccountRole;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
