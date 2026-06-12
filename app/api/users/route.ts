/**
 * GET /api/users - List users for the org (PostgreSQL native)
 * POST /api/users - Create a new user
 */
import { randomBytes } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/src/lib/auth/session";
import * as usersQueries from "@/src/lib/db/queries/users";
import { AppError } from "@/src/lib/errors";
import { z } from "zod";

export const dynamic = "force-dynamic";

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? "supabase";

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

export async function GET(): Promise<NextResponse> {
  try {
    if (AUTH_PROVIDER !== "local") {
      return NextResponse.json(
        { error: "PostgreSQL auth not enabled" },
        { status: 400 },
      );
    }

    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const userOrgId = gate.session.orgId;
    const users = await usersQueries.getUsers(userOrgId, gate.session.id);

    return NextResponse.json({ users }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/users]", err);
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

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    if (AUTH_PROVIDER !== "local") {
      return NextResponse.json(
        { error: "PostgreSQL auth not enabled" },
        { status: 400 },
      );
    }

    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = createUserSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("[POST /api/users] validation failed:", JSON.stringify(parsed.error.issues));
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 },
      );
    }

    const temporaryPassword =
      randomBytes(6).toString('hex').toUpperCase().slice(0, 4) +
      randomBytes(6).toString('hex').slice(0, 4) +
      '@1';

    const userOrgId = gate.session.orgId;
    const result = await usersQueries.createUser(userOrgId, gate.session.id, {
      ...parsed.data,
      password: temporaryPassword,
      forcePasswordChange: parsed.data.forcePasswordChange ?? true,
    });

    return NextResponse.json(
      { user: { email: parsed.data.email }, temporaryPassword },
      { status: 201 },
    );
  } catch (err) {
    console.error("[POST /api/users]", err);
    if (err instanceof AppError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode },
      );
    }

    const errorMessage = (err as any)?.message || "";
    if (errorMessage.includes("unique") || errorMessage.includes("uq_users")) {
      return NextResponse.json(
        { error: "A user with this email already exists in this org." },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
