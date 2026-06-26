import { AccountRole } from "@/generated/prisma/client";
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      accountId: string;
      accountRole: AccountRole;
    } & DefaultSession["user"];
  }

  interface User {
    accountId: string;
    accountRole: AccountRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    accountId: string;
    accountRole: AccountRole;
  }
}

export {};
