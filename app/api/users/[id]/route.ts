/**
 * GET /api/users/[id] - Get single user
 * PATCH /api/users/[id] - Update user
 * DELETE /api/users/[id] - Soft-delete user
 */
import { NextResponse, type NextRequest } from "next/server";
import { withRoute } from "@/src/lib/api/route-handler";
import * as usersQueries from "@/src/lib/db/queries/users";
import { z } from "zod";

export const dynamic = "force-dynamic";

const updateUserSchema = z.object({
  firstName: z.string().max(50).optional(),
  middleName: z.string().max(50).optional(),
  lastName: z.string().max(50).optional(),
  email: z.string().email().optional(),
  mobile: z.string().max(20).optional(),
  password: z.string().min(10).max(128).optional(),
  roleName: z.string().optional(),
  managerId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  is_active: z.boolean().optional(),
  forcePasswordChange: z.boolean().optional(),
});

export const GET = withRoute<{ id: string }>(async (_req, session, { id }) => {
  const user = await usersQueries.getUserById(session.orgId, session.id, id);
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json(user, { status: 200 });
});

export const PATCH = withRoute<{ id: string }>(async (req: NextRequest, session, { id }) => {
  const body = await req.json();
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await usersQueries.updateUser(session.orgId, session.id, id, parsed.data);
    if (!result) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json({ id: result.id }, { status: 200 });
  } catch (err) {
    const msg = (err as any)?.message ?? "";
    if (msg.includes("unique") || msg.includes("uq_users")) {
      return NextResponse.json(
        { error: "A user with this email already exists." },
        { status: 409 },
      );
    }
    throw err;
  }
});

export const DELETE = withRoute<{ id: string }>(async (_req, session, { id }) => {
  await usersQueries.deleteUser(session.orgId, session.id, id);
  return NextResponse.json({ success: true }, { status: 200 });
});
