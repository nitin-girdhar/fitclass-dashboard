/**
 * GET /api/users/[id] - Get single user
 * PATCH /api/users/[id] - Update user
 * DELETE /api/users/[id] - Soft-delete user (PostgreSQL native)
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/src/lib/auth/session";
import * as usersQueries from "@/src/lib/db/queries/users";
import { AppError } from "@/src/lib/errors";
import { z } from "zod";

export const dynamic = "force-dynamic";

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? "supabase";

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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (AUTH_PROVIDER !== "local") {
      return NextResponse.json(
        { error: "PostgreSQL auth not enabled" },
        { status: 400 },
      );
    }

    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    const userOrgId = gate.session.orgId;
    const user = await usersQueries.getUserById(userOrgId, gate.session.id, id);

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(user, { status: 200 });
  } catch (err) {
    console.error("[GET /api/users/[id]]", err);
    if (err instanceof AppError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (AUTH_PROVIDER !== "local") {
      return NextResponse.json(
        { error: "PostgreSQL auth not enabled" },
        { status: 400 },
      );
    }

    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const body = await req.json();
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const { id } = await params;
    const userOrgId = gate.session.orgId;
    const result = await usersQueries.updateUser(
      userOrgId,
      gate.session.id,
      id,
      parsed.data,
    );

    if (!result) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ id: result.id }, { status: 200 });
  } catch (err) {
    console.error("[PATCH /api/users/[id]]", err);
    if (err instanceof AppError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode },
      );
    }

    const errorMessage = (err as any)?.message || "";
    if (errorMessage.includes("unique") || errorMessage.includes("uq_users")) {
      return NextResponse.json(
        { error: "A user with this email already exists." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    if (AUTH_PROVIDER !== "local") {
      return NextResponse.json(
        { error: "PostgreSQL auth not enabled" },
        { status: 400 },
      );
    }

    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { id } = await params;
    const userOrgId = gate.session.orgId;
    await usersQueries.deleteUser(userOrgId, gate.session.id, id);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error("[DELETE /api/users/[id]]", err);
    if (err instanceof AppError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode },
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
