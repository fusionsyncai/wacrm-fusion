import { NextResponse } from "next/server";

import type { WhatsappConfigStatus } from "@/generated/prisma/client";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { serializeWhatsappConfigRow } from "@/lib/db/api-serialize";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/whatsapp/encryption";
import {
  registerPhoneNumber,
  resolveWabaId,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from "@/lib/whatsapp/meta-api";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const accountId = ctx.accountId;

    const config = await prisma.whatsappConfig.findUnique({
      where: { accountId },
    });

    const safeConfig = config
      ? (() => {
          const row = serializeWhatsappConfigRow(config);
          return {
            id: row.id,
            user_id: row.user_id,
            account_id: row.account_id,
            phone_number_id: row.phone_number_id,
            waba_id: row.waba_id,
            status: row.status,
            connected_at: row.connected_at,
            registered_at: row.registered_at,
            subscribed_apps_at: row.subscribed_apps_at,
            last_registration_error: row.last_registration_error,
            created_at: row.created_at,
            updated_at: row.updated_at,
            has_access_token: Boolean(config.accessToken),
          };
        })()
      : null;

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          config: null,
          reason: "no_config",
          message:
            "No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.",
        },
        { status: 200 },
      );
    }

    let accessToken: string;
    try {
      accessToken = decrypt(config.accessToken);
    } catch (err) {
      console.error("[whatsapp/config GET] Token decryption failed:", err);
      return NextResponse.json(
        {
          connected: false,
          config: safeConfig,
          reason: "token_corrupted",
          needs_reset: true,
          message:
            "The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments (local vs Hostinger vs Vercel). Click \"Reset Configuration\" below, then re-save.",
        },
        { status: 200 },
      );
    }

    try {
      const phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phoneNumberId,
        accessToken,
      });
      return NextResponse.json({ connected: true, config: safeConfig, phone_info: phoneInfo });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown Meta API error";
      console.error("[whatsapp/config GET] Meta API verification failed:", message);
      return NextResponse.json(
        {
          connected: false,
          config: safeConfig,
          reason: "meta_api_error",
          message: `Meta API rejected the credentials: ${message}`,
        },
        { status: 200 },
      );
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "UnauthorizedError" || err.name === "ForbiddenError")
    ) {
      return toErrorResponse(err);
    }
    console.error("Error in WhatsApp config GET:", err);
    return NextResponse.json(
      { connected: false, config: null, reason: "unknown", message: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const accountId = ctx.accountId;

    const body = await request.json();
    const { phone_number_id, waba_id, access_token, verify_token, pin } = body;

    if (!access_token || !phone_number_id) {
      return NextResponse.json(
        { error: "access_token and phone_number_id are required" },
        { status: 400 },
      );
    }

    if (pin !== undefined && pin !== null && pin !== "") {
      if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
        return NextResponse.json(
          { error: "PIN must be exactly 6 digits." },
          { status: 400 },
        );
      }
    }

    const claimed = await prisma.whatsappConfig.findFirst({
      where: {
        phoneNumberId: phone_number_id,
        accountId: { not: accountId },
      },
      select: { accountId: true },
    });

    if (claimed) {
      return NextResponse.json(
        {
          error:
            "This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one wacrm user.",
        },
        { status: 409 },
      );
    }

    let phoneInfo;
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: phone_number_id,
        accessToken: access_token,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown Meta API error";
      console.error("Meta API verification failed during save:", message);
      return NextResponse.json({ error: `Meta API error: ${message}` }, { status: 400 });
    }

    let encryptedAccessToken: string;
    let encryptedVerifyToken: string | null;
    try {
      encryptedAccessToken = encrypt(access_token);
      encryptedVerifyToken = verify_token ? encrypt(verify_token) : null;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown encryption error";
      console.error("Encryption failed:", message);
      return NextResponse.json(
        {
          error:
            "Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.",
        },
        { status: 500 },
      );
    }

    const existing = await prisma.whatsappConfig.findUnique({
      where: { accountId },
      select: { id: true, registeredAt: true, phoneNumberId: true },
    });

    const sameNumber =
      existing?.phoneNumberId === phone_number_id && existing?.registeredAt != null;

    let registeredAt: Date | null = existing?.registeredAt ?? null;
    let registrationError: string | null = null;
    let registrationSkipped = false;

    const needsRegistration =
      !sameNumber || (typeof pin === "string" && pin.length > 0);
    if (needsRegistration) {
      if (!pin) {
        registrationSkipped = true;
      } else {
        try {
          await registerPhoneNumber({
            phoneNumberId: phone_number_id,
            accessToken: access_token,
            pin,
          });
          registeredAt = new Date();
        } catch (err) {
          registrationError =
            err instanceof Error ? err.message : "Unknown Meta API error";
          console.error("Phone number /register failed:", registrationError);
        }
      }
    }

    let subscribedAppsAt: Date | null = null;
    let resolvedWabaId: string | null = waba_id?.trim() || null;
    try {
      resolvedWabaId = await resolveWabaId({
        phoneNumberId: phone_number_id,
        accessToken: access_token,
        storedWabaId: resolvedWabaId,
      });
    } catch (err) {
      console.warn(
        "[whatsapp/config POST] WABA auto-resolve failed:",
        err instanceof Error ? err.message : err,
      );
    }

    if (resolvedWabaId) {
      try {
        await subscribeWabaToApp({
          wabaId: resolvedWabaId,
          accessToken: access_token,
        });
        subscribedAppsAt = new Date();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn("WABA subscribed_apps failed (non-fatal):", message);
      }
    }

    const baseData = {
      phoneNumberId: phone_number_id,
      wabaId: resolvedWabaId,
      accessToken: encryptedAccessToken,
      verifyToken: encryptedVerifyToken,
      status: (registrationError ? "disconnected" : "connected") as WhatsappConfigStatus,
      connectedAt: registrationError ? null : new Date(),
      registeredAt: registrationError ? null : registeredAt,
      subscribedAppsAt: subscribedAppsAt ?? null,
      lastRegistrationError: registrationError,
    };

    if (existing) {
      await prisma.whatsappConfig.update({
        where: { accountId },
        data: baseData,
      });
    } else {
      await prisma.whatsappConfig.create({
        data: {
          accountId,
          userId: ctx.userId,
          ...baseData,
        },
      });
    }

    if (registrationError) {
      return NextResponse.json({
        success: false,
        saved: true,
        registered: false,
        registration_error: registrationError,
        phone_info: phoneInfo,
      });
    }

    return NextResponse.json({
      success: true,
      saved: true,
      registered: registeredAt != null,
      registration_skipped: registrationSkipped,
      phone_info: phoneInfo,
    });
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "UnauthorizedError" || err.name === "ForbiddenError")
    ) {
      return toErrorResponse(err);
    }
    console.error("Error in WhatsApp config POST:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const ctx = await getCurrentAccount();

    await prisma.whatsappConfig.deleteMany({
      where: { accountId: ctx.accountId },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
