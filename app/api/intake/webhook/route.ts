/**
 * POST /api/intake/webhook - Receive inbound leads from external sources
 *
 * Handles webhooks from:
 * - Facebook Lead Ads
 * - Google Forms
 * - WhatsApp
 * - Other webhook integrations
 *
 * Authentication: API key in x-api-key header (mapped to org_id)
 * No JWT required — uses service_role credentials
 */
import { NextRequest, NextResponse } from "next/server";
import { createLeadAsService } from "@/src/lib/db/queries/leads";
import { AppError, ValidationError, ForbiddenError } from "@/src/lib/errors";

export const dynamic = "force-dynamic";

// Simple API key to org mapping (in production, store in a table)
const API_KEY_MAP: Record<string, string> = {
  // 'api-key-1': 'org-uuid-1',
  // Add your mappings here
};

export async function POST(req: NextRequest) {
  try {
    // Extract and validate API key
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing x-api-key header" },
        { status: 401 },
      );
    }

    const orgId = API_KEY_MAP[apiKey];
    if (!orgId) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    // Parse webhook payload
    const body = await req.json();
    const {
      firstName,
      lastName,
      email,
      phone,
      campaignId,
      platformName,
      metadata,
      source,
    } = body;

    if (!firstName) {
      return NextResponse.json(
        { error: "firstName is required" },
        { status: 400 },
      );
    }

    // Create unassigned lead in the pool using service role (bypasses RLS).
    const result = await createLeadAsService(orgId, {
      firstName,
      lastName: lastName || undefined,
      email: email || undefined,
      phone: phone || undefined,
      campaignId: campaignId || undefined,
      metadata: {
        ...metadata,
        webhookSource: source || "unknown",
        ingestedAt: new Date().toISOString(),
      },
      rawWebhookData: body,
    });

    return NextResponse.json(
      { id: result.id, message: "Lead created successfully" },
      { status: 201 },
    );
  } catch (err) {
    console.error("[POST /api/intake/webhook]", err);
    if (err instanceof AppError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode },
      );
    }

    const errorMessage = (err as any)?.message || "";
    if (errorMessage.includes("unique") || errorMessage.includes("duplicate")) {
      return NextResponse.json(
        { error: "Lead with this email already exists" },
        { status: 409 },
      );
    }

    return NextResponse.json(
      { error: "Failed to process webhook" },
      { status: 500 },
    );
  }
}
