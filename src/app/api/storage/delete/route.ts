import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { deleteFromStorage } from "@/lib/storage/server-upload";

export async function POST(request: Request) {
  try {
    await getCurrentAccount();
    const body = await request.json().catch(() => null);
    if (!body?.bucket || !body?.path) {
      return NextResponse.json({ error: "bucket and path required" }, { status: 400 });
    }

    await deleteFromStorage(body.bucket, body.path);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
