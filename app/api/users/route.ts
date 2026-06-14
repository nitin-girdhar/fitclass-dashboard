/**
 * GET /api/users - List users for the org (PostgreSQL native)
 * POST /api/users - Create a new user
 */
import { NextResponse, type NextRequest } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import * as usersQueries from "@/src/lib/db/queries/users";
import { generateTemporaryPassword } from "@/src/lib/auth/password";
import { z } from "zod";

export const dynamic = "force-dynamic";

const createUserSchema = z.object({
  firstName: z.string().min(1).max(50),
  middleName: z.string().max(50).optional(),
  lastName: z.string().max(50).optional(),
  email: z.string().email(),
  mobile: z.string().max(20).optional(),
  roleName: z.string(),
  managerId: z.string().optional(),
  forcePasswordChange: z.boolean().optional(),
});

export const GET = withRoute(async (_req, session) => {
  const users = await usersQueries.getUsers(session.orgId, session.id);
  return NextResponse.json({ users }, { status: 200 });
});

export const POST = withRoute(async (req: NextRequest, session) => {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createUserSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const temporaryPassword = generateTemporaryPassword();

  try {
    await usersQueries.createUser(session.orgId, session.id, {
      ...parsed.data,
      password: temporaryPassword,
      forcePasswordChange: parsed.data.forcePasswordChange ?? true,
    });
  } catch (err) {
    const msg = (err as any)?.message ?? "";
    if (msg.includes("unique") || msg.includes("uq_users")) {
      return NextResponse.json(
        { error: "A user with this email already exists in this org." },
        { status: 409 },
      );
    }
    throw err;
  }

  return NextResponse.json(
    { user: { email: parsed.data.email }, temporaryPassword },
    { status: 201 },
  );
});
