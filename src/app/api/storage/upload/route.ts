import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { uploadToStorage } from "@/lib/storage/server-upload";

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const form = await request.formData();
    const bucket = form.get("bucket");
    const file = form.get("file");

    if (typeof bucket !== "string" || !(file instanceof File)) {
      return NextResponse.json({ error: "bucket and file required" }, { status: 400 });
    }

    const result = await uploadToStorage(bucket, ctx.accountId, file);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
