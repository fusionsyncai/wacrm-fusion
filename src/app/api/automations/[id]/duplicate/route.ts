import { NextResponse } from "next/server";

import type { Prisma } from "@/generated/prisma/client";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { serializeAutomation } from "@/lib/db/api-serialize";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const original = await prisma.automation.findFirst({
      where: { id, accountId: ctx.accountId },
    });
    if (!original) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const copy = await prisma.$transaction(async (tx) => {
      const automation = await tx.automation.create({
        data: {
          accountId: original.accountId,
          userId: ctx.userId,
          name: `${original.name} (Copy)`,
          description: original.description,
          triggerType: original.triggerType,
          triggerConfig: original.triggerConfig as Prisma.InputJsonValue,
          isActive: false,
        },
      });

      const steps = await tx.automationStep.findMany({
        where: { automationId: id },
        orderBy: { position: "asc" },
        select: {
          id: true,
          parentStepId: true,
          branch: true,
          stepType: true,
          stepConfig: true,
          position: true,
        },
      });

      if (steps.length > 0) {
        const idMap = new Map<string, string>();
        const uid = () =>
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2) + Date.now().toString(36);
        for (const row of steps) idMap.set(row.id, uid());

        await tx.automationStep.createMany({
          data: steps.map((row) => ({
            id: idMap.get(row.id)!,
            automationId: automation.id,
            parentStepId: row.parentStepId
              ? idMap.get(row.parentStepId)
              : null,
            branch: row.branch,
            stepType: row.stepType,
            stepConfig: row.stepConfig ?? {},
            position: row.position,
          })),
        });
      }

      return automation;
    });

    return NextResponse.json(
      { automation: serializeAutomation(copy) },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
