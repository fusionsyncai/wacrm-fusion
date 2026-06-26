import { NextResponse } from "next/server";

import { listFlowTemplates } from "@/lib/flows/templates";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

export async function GET() {
  try {
    await getCurrentAccount();

    const templates = listFlowTemplates().map((t) => ({
      slug: t.slug,
      name: t.name,
      description: t.description,
      icon: t.icon,
      trigger_type: t.trigger_type,
      node_count: t.nodes.length,
    }));

    return NextResponse.json({ templates });
  } catch (err) {
    return toErrorResponse(err);
  }
}
