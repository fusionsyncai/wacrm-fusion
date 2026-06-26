import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  loadStepsTree,
  replaceSteps,
  type BuilderStepInput,
} from "@/lib/automations/steps-tree";
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from "@/lib/automations/validate";
import type { Prisma } from "@/generated/prisma/client";
import { serializeAutomation } from "@/lib/db/api-serialize";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const automation = await prisma.automation.findFirst({
      where: { id, accountId: ctx.accountId },
    });

    if (!automation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const steps = await loadStepsTree(id);
    return NextResponse.json({
      automation: serializeAutomation(automation),
      steps,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

    const existing = await prisma.automation.findFirst({
      where: { id, accountId: ctx.accountId },
      select: {
        id: true,
        isActive: true,
        triggerType: true,
        triggerConfig: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const update: {
      name?: string;
      description?: string | null;
      triggerType?: string;
      triggerConfig?: unknown;
      isActive?: boolean;
    } = {};

    for (const k of [
      "name",
      "description",
      "trigger_type",
      "trigger_config",
      "is_active",
    ] as const) {
      if (k in body) {
        if (k === "trigger_type") update.triggerType = body[k];
        else if (k === "trigger_config") update.triggerConfig = body[k];
        else if (k === "is_active") update.isActive = body[k];
        else if (k === "name") update.name = body[k];
        else if (k === "description") update.description = body[k];
      }
    }

    const willBeActive =
      typeof update.isActive === "boolean"
        ? update.isActive
        : existing.isActive;

    if (willBeActive) {
      const mergedTriggerType = (update.triggerType ??
        existing.triggerType) as string;
      const mergedTriggerConfig =
        update.triggerConfig ?? existing.triggerConfig;
      const mergedSteps = Array.isArray(body.steps)
        ? (body.steps as {
            step_type: string;
            step_config: Record<string, unknown>;
          }[])
        : await loadStepsTree(id);
      const issues = [
        ...validateTriggerForActivation(mergedTriggerType, mergedTriggerConfig),
        ...validateStepsForActivation(mergedSteps),
      ];
      if (issues.length > 0) {
        return NextResponse.json(
          {
            error: "Cannot keep automation active with invalid configuration",
            issues,
          },
          { status: 400 },
        );
      }
    }

    if (Object.keys(update).length > 0) {
      await prisma.automation.update({
        where: { id },
        data: {
          ...update,
          triggerConfig: update.triggerConfig as Prisma.InputJsonValue | undefined,
        },
      });
    }

    if (Array.isArray(body.steps)) {
      const err = await replaceSteps(id, body.steps as BuilderStepInput[]);
      if (err) return NextResponse.json({ error: err }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const result = await prisma.automation.deleteMany({
      where: { id, accountId: ctx.accountId },
    });

    if (result.count === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
