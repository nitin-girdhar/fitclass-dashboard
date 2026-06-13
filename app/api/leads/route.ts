/**
 * GET /api/leads - List leads for the org (PostgreSQL native)
 * POST /api/leads - Create a new lead
 */
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/src/lib/auth/session";
import * as leadsQueries from "@/src/lib/db/queries/leads";
import { AppError } from "@/src/lib/errors";
import { withServiceTx } from "@/src/lib/db/transaction";
import { z } from "zod";

export const dynamic = "force-dynamic";

const AUTH_PROVIDER = process.env.AUTH_PROVIDER ?? "supabase";

// Fixed column headers returned for DB-sourced leads.
// Order must match rawCells indexing in adaptLeadView below.
const DB_LEAD_HEADERS = [
  'Date', 'Name', 'Phone Number', 'Status',
];

// tx.unsafe() returns snake_case column names (the camelCase transform only
// applies to the postgres.js tagged-template path). Handle both forms so the
// adapter works whether called from withOrgTx or withServiceTx.
function pick(row: Record<string, any>, camel: string, snake: string): any {
  return row[camel] !== undefined ? row[camel] : row[snake];
}

function toDateString(v: unknown): string {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

// Adapts a DB LeadView row to the Sheets-compatible Lead shape the UI expects.
// leadId is included as an extra field so AG Grid getRowId can use it.
function adaptLeadView(view: Record<string, any>, index: number) {
  const createdAt     = pick(view, 'createdAt',      'created_at');
  const fullName      = pick(view, 'fullName',        'full_name')      ?? '';
  const campaignName  = pick(view, 'campaignName',    'campaign_name')  ?? '';
  const platform      = view.platform                                   ?? '';
  const leadId        = pick(view, 'leadId',          'lead_id');
  const orgId         = pick(view, 'orgId',           'org_id');
  const orgName       = pick(view, 'orgName',         'org_name')       ?? '';
  const assignedUserId   = pick(view, 'assignedUserId',   'assigned_user_id')   ?? null;
  const assignedRepName  = pick(view, 'assignedRepName',  'assigned_rep_name')  ?? null;
  const addressLine1  = pick(view, 'addressLine1',    'address_line1')  ?? '';

  const dateStr = toDateString(createdAt);

  const rawCells: string[] = [
    dateStr,
    fullName,
    view.phone  ?? '',
    view.status ?? '',
  ];

  return {
    leadId,
    rowIndex:           index + 1,
    rawCells,
    createdTime:        dateStr,
    Status:             view.status  ?? '',
    Comments:           '',
    transferTo:         '',
    fullName,
    phoneNumber:        view.phone   ?? '',
    email:              view.email   ?? '',
    address:            [addressLine1, view.city, view.state, view.country].filter(Boolean).join(', '),
    reason:             '',
    campaignName,
    joiningPlan:        '',
    membershipInterest: '',
    fitnessGoal:        '',
    // Extra DB fields used by the inline-assignment column and future update path
    orgId,
    orgName,
    platform,
    assignedUserId,
    assignedRepName,
  };
}

const createLeadSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100).optional(),
  middleName: z.string().max(100).optional(),
  email: z.string().email().optional(),
  phone: z.string().max(20).optional(),
  campaignId: z.string().uuid().optional(),
  cityId: z.number().optional(),
  stateId: z.number().optional(),
  countryId: z.number().optional(),
  addressLine1: z.string().max(255).optional(),
  pincode: z.string().max(20).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  rawWebhookData: z.record(z.string(), z.unknown()).optional(),
  /** Walk-in: assign to this user on creation. */
  assignedUserId: z.string().uuid().optional(),
  /** Walk-in: create lead in this org (must be in the actor's tenant). */
  orgId: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  try {
    if (AUTH_PROVIDER !== "local") {
      // Fall back to existing Supabase path if not using PostgreSQL
      return NextResponse.json(
        {
          error:
            "PostgreSQL auth not enabled. Set AUTH_PROVIDER=local to use new API.",
        },
        { status: 400 },
      );
    }

    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || undefined;
    const assignedTo = searchParams.get("assignedTo") || undefined;
    const campaignId = searchParams.get("campaignId") || undefined;
    const search = searchParams.get("search") || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "50", 10);
    // Lead-source (platform) filter: comma-separated platform names
    const rawPlatforms = searchParams.get("platforms");
    const platforms = rawPlatforms ? rawPlatforms.split(",").filter(Boolean) : undefined;

    // Multi-org filter: comma-separated list of org UUIDs the client selected.
    // Validate each is a UUID belonging to the user's tenant before using.
    const rawOrgIds = searchParams.get("orgIds");
    let orgIds: string[] | undefined;
    if (rawOrgIds) {
      const requested = rawOrgIds.split(",").filter(Boolean);
      if (requested.length > 0) {
        // Security: ensure all requested orgs are within the user's own tenant
        const userOrgId = gate.session.orgId;
        const allowed: { id: string }[] = await withServiceTx(async (tx) =>
          tx.unsafe(
            `SELECT id FROM organizations
             WHERE id = ANY($1::uuid[])
               AND tenant_id = (SELECT tenant_id FROM organizations WHERE id = $2::uuid)
               AND NOT is_deleted`,
            [requested, userOrgId],
          ),
        );
        const allowedSet = new Set(allowed.map((r) => r.id));
        orgIds = requested.filter((id) => allowedSet.has(id));
      }
    }

    const userOrgId = gate.session.orgId;

    const result = await leadsQueries.getLeads(userOrgId, gate.session.id, {
      status,
      assignedTo,
      campaignId,
      search,
      platforms,
      page,
      pageSize,
      orgIds,
      actorRank: gate.session.rank,
    });

    const adaptedLeads = (result.leads as Record<string, any>[]).map(adaptLeadView);
    const rawStatusOptions = result.statusOptions as { name: string; label?: string; requires_followup?: boolean; is_rejection?: boolean }[];
    const statusOptionNames = rawStatusOptions.map((s) => s.name);
    const statusLabelMap: Record<string, string> = {};
    for (const s of rawStatusOptions) {
      statusLabelMap[s.name] = s.label ?? s.name;
    }
    const requiresFollowupStatuses = rawStatusOptions
      .filter((s) => s.requires_followup)
      .map((s) => s.name);
    const rejectionStatuses = rawStatusOptions
      .filter((s) => s.is_rejection)
      .map((s) => s.name);
    const rawFailReasons = result.failReasons as { id: number; name: string; label: string }[];

    // Build assignments map keyed by rowIndex so LeadsTable can show
    // who is currently assigned without a separate API call.
    const assignments: Record<number, {
      id: string; lead_id: string; branch: string;
      assigned_to: string; assigned_by: string; assigned_at: string;
      notes: null; assignee_name: string | null; assignee_email: null;
    }> = {};
    adaptedLeads.forEach((lead) => {
      if (lead.assignedUserId && lead.leadId) {
        assignments[lead.rowIndex] = {
          id:             lead.leadId,
          lead_id:        lead.leadId,
          branch:         '',
          assigned_to:    lead.assignedUserId,
          assigned_by:    '',
          assigned_at:    lead.createdTime ?? '',
          notes:          null,
          assignee_name:  lead.assignedRepName ?? null,
          assignee_email: null,
        };
      }
    });

    return NextResponse.json(
      {
        leads:                   adaptedLeads,
        headers:                 DB_LEAD_HEADERS,
        statusOptions:           statusOptionNames,
        statusLabelMap,
        requiresFollowupStatuses,
        rejectionStatuses,
        failReasons:             rawFailReasons,
        assignments,
        total:         result.total,
        page:          result.page,
        pageSize:      result.pageSize,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[GET /api/leads]", err);
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

export async function POST(req: NextRequest) {
  try {
    if (AUTH_PROVIDER !== "local") {
      return NextResponse.json(
        {
          error:
            "PostgreSQL auth not enabled. Set AUTH_PROVIDER=local to use new API.",
        },
        { status: 400 },
      );
    }

    const gate = await requireSession();
    if (!gate.ok) return gate.response;

    const body = await req.json();
    const parsed = createLeadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 },
      );
    }

    // Resolve effective org — use actor's own org unless a valid override provided
    let effectiveOrgId = gate.session.orgId;
    if (parsed.data.orgId && parsed.data.orgId !== gate.session.orgId) {
      const orgs: { id: string }[] = await withServiceTx((tx) =>
        tx.unsafe(
          `SELECT id FROM organizations
           WHERE id = $1::uuid
             AND tenant_id = (SELECT tenant_id FROM organizations WHERE id = $2::uuid)
             AND NOT is_deleted`,
          [parsed.data.orgId, gate.session.orgId],
        ),
      );
      if (orgs.length === 0) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      effectiveOrgId = parsed.data.orgId;
    }

    const result = await leadsQueries.createLead(
      effectiveOrgId,
      gate.session.id,
      parsed.data,
    );

    revalidatePath("/dashboard/assignments");
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/leads]", err);
    if (err instanceof AppError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.statusCode },
      );
    }
    // Duplicate phone/email within the same org
    if ((err as any)?.field === "phone") {
      return NextResponse.json(
        { error: "A lead with this phone number already exists in this branch.", field: "phone" },
        { status: 409 },
      );
    }
    if ((err as any)?.field === "email") {
      return NextResponse.json(
        { error: "A lead with this email already exists in this branch.", field: "email" },
        { status: 409 },
      );
    }
    // Handle known PostgreSQL constraint violations
    const errorMessage = (err as any)?.message || "";
    if (errorMessage.includes("fail_reason")) {
      return NextResponse.json(
        { error: "A fail reason must be selected when marking a lead as failed." },
        { status: 400 },
      );
    }
    if (errorMessage.includes("uq_marketing_leads")) {
      return NextResponse.json(
        { error: "Lead with this email already exists." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
