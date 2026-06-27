import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import type { JWT } from "next-auth/jwt";
import { z } from "zod";

import { authConfig } from "@/auth.config";
import type { AccountRole } from "@/generated/prisma/client";
import { ensureAuthUrlEnv } from "@/lib/env/ensure-auth-url";
import { prisma } from "@/lib/prisma";

ensureAuthUrlEnv();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

async function applyUserToToken(token: JWT, userId: string) {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: {
      userId: true,
      accountId: true,
      accountRole: true,
      fullName: true,
      email: true,
    },
  });

  if (!profile) {
    return token;
  }

  token.sub = profile.userId;
  token.accountId = profile.accountId;
  token.accountRole = profile.accountRole;
  token.name = profile.fullName;
  token.email = profile.email;

  return token;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  trustHost: true,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
          include: {
            profile: {
              select: { accountId: true, accountRole: true },
            },
          },
        });

        if (!user?.passwordHash || !user.profile) return null;

        const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          accountId: user.profile.accountId,
          accountRole: user.profile.accountRole,
        };
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
        token.accountId = user.accountId;
        token.accountRole = user.accountRole;
        return token;
      }

      if (token.sub && !token.accountId) {
        return applyUserToToken(token, token.sub);
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
});
