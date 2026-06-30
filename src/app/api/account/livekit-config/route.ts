import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { serializeAccountLivekitConfig } from "@/lib/db/serialize-livekit";
import { getAccountLivekitConfig } from "@/lib/livekit/account-config";
import { normalizeLiveKitWsUrl } from "@/lib/livekit/normalize-url";
import { testLivekitConnection } from "@/lib/livekit/test-connection";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/whatsapp/encryption";

export async function GET() {
  try {
    const ctx = await requireRole("admin");
    const row = await prisma.accountLivekitConfig.findUnique({
      where: { accountId: ctx.accountId },
    });
    return NextResponse.json({
      config: row ? serializeAccountLivekitConfig(row) : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const {
      livekit_url,
      api_key,
      api_secret,
      agent_name,
      test_connection,
    } = body as {
      livekit_url?: unknown;
      api_key?: unknown;
      api_secret?: unknown;
      agent_name?: unknown;
      test_connection?: unknown;
    };

    if (typeof livekit_url !== "string" || !livekit_url.trim()) {
      return NextResponse.json({ error: "livekit_url is required" }, { status: 400 });
    }

    const existing = await prisma.accountLivekitConfig.findUnique({
      where: { accountId: ctx.accountId },
    });

    const wsUrl = normalizeLiveKitWsUrl(livekit_url);
    const nextKey =
      typeof api_key === "string" && api_key.trim()
        ? encrypt(api_key.trim())
        : existing?.apiKey;
    const nextSecret =
      typeof api_secret === "string" && api_secret.trim()
        ? encrypt(api_secret.trim())
        : existing?.apiSecret;

    if (!nextKey || !nextSecret) {
      return NextResponse.json(
        { error: "api_key and api_secret are required" },
        { status: 400 },
      );
    }

    const agentName =
      typeof agent_name === "string" && agent_name.trim()
        ? agent_name.trim()
        : existing?.agentName ?? "wacrm-voice";

    const row = await prisma.accountLivekitConfig.upsert({
      where: { accountId: ctx.accountId },
      create: {
        accountId: ctx.accountId,
        livekitUrl: wsUrl,
        apiKey: nextKey,
        apiSecret: nextSecret,
        agentName,
        setupStatus: "pending",
      },
      update: {
        livekitUrl: wsUrl,
        apiKey: nextKey,
        apiSecret: nextSecret,
        agentName,
        setupStatus: "pending",
        setupError: null,
      },
    });

    if (test_connection === true) {
      const decrypted = await getAccountLivekitConfig(ctx.accountId);
      if (!decrypted) {
        return NextResponse.json({ error: "Config missing after save" }, { status: 500 });
      }
      try {
        await testLivekitConnection(decrypted);
        await prisma.accountLivekitConfig.update({
          where: { accountId: ctx.accountId },
          data: { setupStatus: "ready", setupError: null },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Connection test failed";
        await prisma.accountLivekitConfig.update({
          where: { accountId: ctx.accountId },
          data: { setupStatus: "error", setupError: message },
        });
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    const refreshed = await prisma.accountLivekitConfig.findUnique({
      where: { accountId: ctx.accountId },
    });

    return NextResponse.json({
      config: serializeAccountLivekitConfig(refreshed ?? row),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole("admin");
    await prisma.accountLivekitConfig.deleteMany({
      where: { accountId: ctx.accountId },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
