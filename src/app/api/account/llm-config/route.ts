import { NextResponse } from "next/server";

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from "@/lib/auth/account";
import { enforceSingleDefaultLlmProvider } from "@/lib/llm/account-config";
import { testLlmConnection } from "@/lib/llm/client";
import {
  isValidModelForProvider,
  LLM_PROVIDERS,
  modelsForProvider,
} from "@/lib/llm/models";
import { serializeAccountLlmConfig } from "@/lib/db/serialize-llm";
import { encrypt } from "@/lib/whatsapp/encryption";
import { prisma } from "@/lib/prisma";
import type { LlmProvider } from "@/types";

function isLlmProvider(value: unknown): value is LlmProvider {
  return (
    typeof value === "string" &&
    (LLM_PROVIDERS as readonly string[]).includes(value)
  );
}

export async function GET() {
  try {
    await getCurrentAccount();
    const ctx = await requireRole("admin");

    const rows = await prisma.accountLlmConfig.findMany({
      where: { accountId: ctx.accountId },
      orderBy: { provider: "asc" },
    });

    return NextResponse.json({
      configs: rows.map(serializeAccountLlmConfig),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = await request.json();
    const { provider, model_id, api_key, test_connection, is_default } = body as {
      provider?: unknown;
      model_id?: unknown;
      api_key?: unknown;
      test_connection?: unknown;
      is_default?: unknown;
    };

    if (!isLlmProvider(provider)) {
      return NextResponse.json(
        { error: "provider must be OPENAI, GEMINI, OPEN_ROUTER, or GROQ" },
        { status: 400 },
      );
    }

    if (typeof model_id !== "string" || !model_id.trim()) {
      return NextResponse.json({ error: "model_id is required" }, { status: 400 });
    }

    const modelId = model_id.trim();
    if (!isValidModelForProvider(provider, modelId)) {
      return NextResponse.json(
        { error: `Invalid model_id for provider ${provider}` },
        { status: 400 },
      );
    }

    const existing = await prisma.accountLlmConfig.findUnique({
      where: {
        accountId_provider: { accountId: ctx.accountId, provider },
      },
    });

    let encryptedKey = existing?.apiKey;
    if (typeof api_key === "string" && api_key.trim()) {
      try {
        encryptedKey = encrypt(api_key.trim());
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to encrypt API key";
        return NextResponse.json({ error: message }, { status: 500 });
      }
    }

    if (!encryptedKey) {
      return NextResponse.json(
        { error: "api_key is required when connecting a provider for the first time" },
        { status: 400 },
      );
    }

    const count = await prisma.accountLlmConfig.count({
      where: { accountId: ctx.accountId },
    });
    const shouldDefault =
      is_default === true || count === 0 || existing?.isDefault === true;

    const saved = await prisma.accountLlmConfig.upsert({
      where: {
        accountId_provider: { accountId: ctx.accountId, provider },
      },
      create: {
        accountId: ctx.accountId,
        provider,
        modelId,
        apiKey: encryptedKey,
        isDefault: shouldDefault,
      },
      update: {
        modelId,
        apiKey: encryptedKey,
        ...(is_default === true ? { isDefault: true } : {}),
      },
    });

    if (shouldDefault || is_default === true) {
      await enforceSingleDefaultLlmProvider(ctx.accountId, provider);
    }

    if (test_connection === true) {
      try {
        await testLlmConnection(ctx.accountId, provider);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "LLM connection test failed";
        return NextResponse.json({ error: message }, { status: 400 });
      }
    }

    const refreshed = await prisma.accountLlmConfig.findUnique({
      where: { id: saved.id },
    });

    return NextResponse.json({
      config: serializeAccountLlmConfig(refreshed ?? saved),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = await request.json().catch(() => ({}));

    if (body?.action === "test") {
      if (!isLlmProvider(body.provider)) {
        return NextResponse.json(
          { error: "provider is required for test" },
          { status: 400 },
        );
      }
      await testLlmConnection(ctx.accountId, body.provider);
      return NextResponse.json({ ok: true });
    }

    if (body?.action === "set_default") {
      if (!isLlmProvider(body.provider)) {
        return NextResponse.json(
          { error: "provider is required" },
          { status: 400 },
        );
      }
      const row = await prisma.accountLlmConfig.findUnique({
        where: {
          accountId_provider: { accountId: ctx.accountId, provider: body.provider },
        },
      });
      if (!row) {
        return NextResponse.json(
          { error: "Configure this provider before setting it as default" },
          { status: 400 },
        );
      }
      await enforceSingleDefaultLlmProvider(ctx.accountId, body.provider);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "LLM request failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const body = await request.json().catch(() => ({}));
    if (!isLlmProvider(body.provider)) {
      return NextResponse.json({ error: "provider is required" }, { status: 400 });
    }

    const existing = await prisma.accountLlmConfig.findUnique({
      where: {
        accountId_provider: { accountId: ctx.accountId, provider: body.provider },
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Provider not configured" }, { status: 404 });
    }

    await prisma.accountLlmConfig.delete({ where: { id: existing.id } });

    if (existing.isDefault) {
      const next = await prisma.accountLlmConfig.findFirst({
        where: { accountId: ctx.accountId },
        orderBy: { createdAt: "asc" },
      });
      if (next) {
        await enforceSingleDefaultLlmProvider(ctx.accountId, next.provider);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function OPTIONS() {
  return NextResponse.json({
    providers: LLM_PROVIDERS,
    models: Object.fromEntries(
      LLM_PROVIDERS.map((p) => [p, modelsForProvider(p)]),
    ),
  });
}
