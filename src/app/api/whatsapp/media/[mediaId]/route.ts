import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/whatsapp/encryption";
import { getMediaUrl, downloadMedia } from "@/lib/whatsapp/meta-api";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mediaId: string }> },
) {
  try {
    const { mediaId } = await params;

    if (!mediaId) {
      return NextResponse.json({ error: "Media ID is required" }, { status: 400 });
    }

    const ctx = await getCurrentAccount();

    const config = await prisma.whatsappConfig.findUnique({
      where: { accountId: ctx.accountId },
    });

    if (!config) {
      return NextResponse.json({ error: "WhatsApp not configured" }, { status: 400 });
    }

    const accessToken = decrypt(config.accessToken);
    const mediaInfo = await getMediaUrl({ mediaId, accessToken });
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: mediaInfo.url,
      accessToken,
    });

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          contentType || mediaInfo.mimeType || "application/octet-stream",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "UnauthorizedError") {
      return toErrorResponse(err);
    }
    console.error("Error in WhatsApp media GET:", err);
    return NextResponse.json({ error: "Failed to fetch media" }, { status: 500 });
  }
}
