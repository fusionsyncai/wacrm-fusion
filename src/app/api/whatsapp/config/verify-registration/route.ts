import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/whatsapp/encryption";
import {
  getSubscribedApps,
  verifyPhoneNumber,
} from "@/lib/whatsapp/meta-api";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const config = await prisma.whatsappConfig.findUnique({
      where: { accountId: ctx.accountId },
    });

    if (!config) {
      return NextResponse.json({
        live: false,
        checks: { config_exists: false },
        message: "No WhatsApp configuration saved yet.",
      });
    }

    let accessToken: string;
    try {
      accessToken = decrypt(config.accessToken);
    } catch {
      return NextResponse.json({
        live: false,
        checks: {
          config_exists: true,
          token_decryptable: false,
        },
        message:
          "Stored access token can't be decrypted — likely ENCRYPTION_KEY changed. Re-enter the token to repair.",
      });
    }

    const checks: {
      config_exists: boolean;
      token_decryptable: boolean;
      phone_metadata_ok: boolean;
      waba_subscribed_to_app: boolean | null;
      locally_marked_registered: boolean;
    } = {
      config_exists: true,
      token_decryptable: true,
      phone_metadata_ok: false,
      waba_subscribed_to_app: null,
      locally_marked_registered: config.registeredAt != null,
    };
    const errors: string[] = [];

    try {
      await verifyPhoneNumber({
        phoneNumberId: config.phoneNumberId,
        accessToken,
      });
      checks.phone_metadata_ok = true;
    } catch (err) {
      errors.push(
        `Phone metadata check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (config.wabaId) {
      try {
        const subs = await getSubscribedApps({
          wabaId: config.wabaId,
          accessToken,
        });
        checks.waba_subscribed_to_app = subs.length > 0;
        if (!checks.waba_subscribed_to_app) {
          errors.push(
            "WABA has no subscribed apps. Re-save the configuration to subscribe.",
          );
        }
      } catch (err) {
        errors.push(
          `WABA subscription check failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      errors.push(
        "No WABA ID on file — webhooks can't be wired without it. Add it in the form and re-save.",
      );
    }

    const live =
      checks.phone_metadata_ok &&
      (checks.waba_subscribed_to_app ?? false) &&
      checks.locally_marked_registered;

    return NextResponse.json({
      live,
      checks,
      errors,
      last_registration_error: config.lastRegistrationError ?? null,
      registered_at: config.registeredAt?.toISOString() ?? null,
      subscribed_apps_at: config.subscribedAppsAt?.toISOString() ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
