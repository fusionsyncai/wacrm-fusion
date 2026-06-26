import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { findExistingContact } from "@/lib/contacts/dedupe.server";

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get("phone");
    if (!phone) {
      return NextResponse.json({ error: "phone is required" }, { status: 400 });
    }

    const existing = await findExistingContact(ctx.accountId, phone);
    return NextResponse.json({ contact: existing });
  } catch (err) {
    return toErrorResponse(err);
  }
}
