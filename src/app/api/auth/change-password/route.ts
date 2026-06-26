import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";

import { getSessionUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const schema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(8),
});

export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { passwordHash: true },
  });

  if (!user?.passwordHash) {
    return NextResponse.json({ error: "Password change not available" }, { status: 400 });
  }

  const valid = await bcrypt.compare(parsed.data.current_password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  const passwordHash = await bcrypt.hash(parsed.data.new_password, 12);
  await prisma.user.update({
    where: { id: sessionUser.id },
    data: { passwordHash },
  });

  return NextResponse.json({ success: true });
}
