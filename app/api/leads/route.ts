/**
 * GET /api/leads - List leads for the org (PostgreSQL native)
 * POST /api/leads - Create a new lead
 */
import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { withRoute } from "@/src/lib/api/route-handler";
import * as leadsQueries from "@/src/lib/db/queries/leads";
import { withServiceTx } from "@/src/lib/db/transaction";
import { resolveActorOrgIds } from "@/src/lib/permissions/scope";
import { RANKS } from "@/src/lib/permissions/ranks";
import { z } from "zod";

export const dynamic = "force-dynamic";

// Fixed column headers returned for DB-sourced leads.
// Order must match rawCells indexing in adaptLeadView below.
const DB_LEAD_HEADERS = ["Date", "Name", "Phone Number", "Status", "Outcome"];

// tx.unsafe() returns snake_case column names (the camelCase transform only
// applies to the postgres.js tagged-template path). Handle both forms so the
// adapter works whether called from withOrgTx or withServiceTx.
function pick(row: Record<string, any>, camel: string, snake: string): any {
  return row[camel] !== undefined ? row[camel] : row[snake];
}

function toDateString(v: unknown): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function adaptLeadView(view: Record<string, any>, index: number) {
  const createdAt    = pick(view, "createdAt",     "created_at");
  const fullName     = pick(view, "fullName",       "full_name")     ?? "";
  const campaignName = pick(view, "campaignName",   "campaign_name") ?? "";
  const platform     = view.platform                                  ?? "";
  const leadId       = pick(view, "leadId",         "lead_id");
  const orgId        = pick(view, "orgId",          "org_id");
  const orgName      = pick(view, "orgName",        "org_name")      ?? "";
  const assignedUserId  = pick(view, "assignedUserId",  "assigned_user_id")  ?? null;
  const assignedRepName = pick(view, "assignedRepName", "assigned_rep_name") ?? null;
  const addressLine1 = pick(view, "addressLine1",   "address_line1") ?? "";
  const outcomeLabel   = pick(view, "outcomeLabel",   "outcome_label")   ?? null;
  const outcomeComment = pick(view, "outcomeComment", "outcome_comment") ?? null;
  const outcomeId      = pick(view, "outcomeId",      "outcome_id")      ?? null;
  const stageId        = pick(view, "stageId",        "stage_id")        ?? null;
  const dateStr = toDateString(createdAt);

  const rawCells: string[] = [
    dateStr,
    fullName,
    view.phone     ?? "",
    view.stage     ?? "",
    outcomeLabel   ?? "",
  ];

  return {
    leadId,
    rowIndex:           index + 1,
    rawCells,
    createdTime:        dateStr,
    Status:             view.stage  ?? "",
    Comments:           "",
    transferTo:         "",
    fullName,
    phoneNumber:        view.phone  ?? "",
    email:              view.email  ?? "",
    address:            [addressLine1, view.city, view.state, view.country].filter(Boolean).join(", "),
    reason:             "",
    campaignName,
    joiningPlan:        "",
    membershipInterest: "",
    fitnessGoal:        "",
    orgId,
    orgName,
    platform,
    assignedUserId,
    assignedRepName,
    stageId,
    outcomeId,
    outcomeLabel,
    outcomeComment,
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

export const GET = withRoute(async (req: NextRequest, session) => {
  const { searchParams } = new URL(req.url);
  const status     = searchParams.get("status")     || undefined;
  const assignedTo = searchParams.get("assignedTo") || undefined;
  const campaignId = searchParams.get("campaignId") || undefined;
  const search     = searchParams.get("search")     || undefined;
  const page       = parseInt(searchParams.get("page")     || "1",  10);
  const pageSize   = parseInt(searchParams.get("pageSize") || "50", 10);

  const rawPlatforms = searchParams.get("platforms");
  const platforms = rawPlatforms ? rawPlatforms.split(",").filter(Boolean) : undefined;

  const rawOrgIds = searchParams.get("orgIds");
  // undefined = not yet resolved; null = super_admin (no filter); string[] = scoped
  let orgIds: string[] | null | undefined;
  if (rawOrgIds) {
    // Caller supplied explicit org filter — validate each id is within their tenant.
    const requested = rawOrgIds.split(",").filter(Boolean);
    if (requested.length > 0) {
      const allowed: { id: string }[] = await withServiceTx(async (tx) =>
        tx.unsafe(
          `SELECT id FROM organizations
           WHERE id = ANY($1::uuid[])
             AND tenant_id = (SELECT tenant_id FROM organizations WHERE id = $2::uuid)
             AND NOT is_deleted`,
          [requested, session.orgId],
        ),
      );
      const allowedSet = new Set(allowed.map((r) => r.id));
      orgIds = requested.filter((id) => allowedSet.has(id));
    }
  } else if (session.rank >= RANKS.TENANT_ADMIN) {
    // tenant_admin → string[] scoped to their tenant's orgs
    // super_admin  → null (resolveActorOrgIds returns null = no org restriction)
    orgIds = await resolveActorOrgIds(session);
  }

  const result = await leadsQueries.getLeads(session.orgId, session.id, {
    status,
    assignedTo,
    campaignId,
    search,
    platforms,
    page,
    pageSize,
    orgIds,
    actorRank: session.rank,
  });

  const adaptedLeads = (result.leads as Record<string, any>[]).map(adaptLeadView);
  const rawStageOptions = result.stageOptions as {
    id: number; name: string; label?: string;
    followup_required?: boolean; is_rejected?: boolean; is_terminated?: boolean;
  }[];
  const statusOptionNames = rawStageOptions.map((s) => s.name);
  const statusLabelMap: Record<string, string> = {};
  const stageNameToId: Record<string, number> = {};
  for (const s of rawStageOptions) {
    statusLabelMap[s.name] = s.label ?? s.name;
    stageNameToId[s.name]  = s.id;
  }
  const followupRequiredStages = rawStageOptions.filter((s) => s.followup_required).map((s) => s.name);
  const rejectionStages        = rawStageOptions.filter((s) => s.is_rejected).map((s) => s.name);
  const rawStageOutcomes = result.stageOutcomes as {
    id: number; name: string; label: string; stage_id: number; requires_comment: boolean;
  }[];

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
        branch:         "",
        assigned_to:    lead.assignedUserId,
        assigned_by:    "",
        assigned_at:    lead.createdTime ?? "",
        notes:          null,
        assignee_name:  lead.assignedRepName ?? null,
        assignee_email: null,
      };
    }
  });

  return NextResponse.json(
    {
      leads:                    adaptedLeads,
      headers:                  DB_LEAD_HEADERS,
      statusOptions:            statusOptionNames,
      statusLabelMap,
      requiresFollowupStatuses: followupRequiredStages,
      rejectionStatuses:        rejectionStages,
      failReasons:              rawStageOutcomes,
      stageNameToId,
      assignments,
      total:    result.total,
      page:     result.page,
      pageSize: result.pageSize,
    },
    { status: 200 },
  );
});

export const POST = withRoute(async (req: NextRequest, session) => {
  const body = await req.json();
  const parsed = createLeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.issues },
      { status: 400 },
    );
  }

  let effectiveOrgId = session.orgId;
  if (parsed.data.orgId && parsed.data.orgId !== session.orgId) {
    const orgs: { id: string }[] = await withServiceTx((tx) =>
      tx.unsafe(
        `SELECT id FROM organizations
         WHERE id = $1::uuid
           AND tenant_id = (SELECT tenant_id FROM organizations WHERE id = $2::uuid)
           AND NOT is_deleted`,
        [parsed.data.orgId, session.orgId],
      ),
    );
    if (orgs.length === 0) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    effectiveOrgId = parsed.data.orgId;
  }

  try {
    const result = await leadsQueries.createLead(effectiveOrgId, session.id, parsed.data);
    revalidatePath("/dashboard/assignments");
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (err) {
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
    const msg = (err as any)?.message ?? "";
    if (msg.includes("outcome_id")) {
      return NextResponse.json(
        { error: "An outcome must be selected when marking a lead as unqualified." },
        { status: 400 },
      );
    }
    if (msg.includes("uq_marketing_leads")) {
      return NextResponse.json({ error: "Lead with this email already exists." }, { status: 409 });
    }
    throw err;
  }
});
