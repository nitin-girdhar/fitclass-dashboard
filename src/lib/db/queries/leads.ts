import { withOrgTx, withServiceTx } from "../transaction";
import type { LeadView } from "@/src/types/db";

/**
 * Get paginated list of leads.
 *
 * Single-org path (default): withOrgTx — RLS restricts to session org, is_deleted
 * filtered by RLS USING clause; no need to add it explicitly.
 *
 * Multi-org path (orgIds provided): withServiceTx (BYPASSRLS) — all filters
 * including is_deleted must be applied explicitly in the WHERE clause.
 */
import { RANKS } from '@/src/lib/permissions/ranks';

export async function getLeads(
  orgId: string,
  userId: string,
  filters: {
    status?: string;
    assignedTo?: string;
    campaignId?: string;
    search?: string;
    platforms?: string[];
    page?: number;
    pageSize?: number;
    orgIds?: string[];
    actorRank?: number;
  } = {},
) {
  const page = filters.page ?? 1;
  const pageSize = Math.min(filters.pageSize ?? 50, 500);
  const offset = (page - 1) * pageSize;

  const useMultiOrg = filters.orgIds && filters.orgIds.length > 0;

  const buildQuery = async (tx: any) => {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (useMultiOrg) {
      // Service role — must filter deleted rows explicitly
      conditions.push("NOT is_deleted");
      params.push(filters.orgIds);
      conditions.push(`org_id = ANY($${params.length}::uuid[])`);
    }
    // Single-org: is_deleted filtered by RLS; org scoped by withOrgTx context

    // Sales tier (rank < 2): own leads + unassigned only.
    // Admins/managers/SSE see everything in the org (no extra filter needed).
    if (
      !useMultiOrg &&
      filters.actorRank !== undefined &&
      filters.actorRank < RANKS.SSE
    ) {
      params.push(userId);
      conditions.push(
        `(assigned_user_id = $${params.length}::uuid OR assigned_user_id IS NULL)`,
      );
    }

    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }
    if (filters.assignedTo) {
      params.push(filters.assignedTo);
      conditions.push(`assigned_user_id = $${params.length}::uuid`);
    }
    if (filters.campaignId) {
      params.push(filters.campaignId);
      conditions.push(`campaign_id = $${params.length}::uuid`);
    }
    if (filters.search) {
      params.push(`%${filters.search}%`);
      conditions.push(`full_name ILIKE $${params.length}`);
    }
    if (filters.platforms && filters.platforms.length > 0) {
      params.push(filters.platforms);
      conditions.push(`platform = ANY($${params.length}::text[])`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const dataParams = [...params, pageSize, offset];
    const rows: LeadView[] = await tx.unsafe(
      `SELECT *, COUNT(*) OVER () AS total_count
       FROM vw_dashboard_leads
       ${where}
       ORDER BY created_at DESC
       LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
      dataParams,
    );

    const total = rows[0] ? Number((rows[0] as any).total_count ?? 0) : 0;
    const statusOptions =
      await tx`SELECT id, name, label, requires_followup, is_rejection FROM lead_statuses ORDER BY id`;
    const failReasons =
      await tx`SELECT id, name, label FROM lead_fail_reasons ORDER BY id`;

    return { leads: rows, total, statusOptions, failReasons, page, pageSize };
  };

  if (useMultiOrg) {
    return withServiceTx(buildQuery);
  }
  return withOrgTx(orgId, userId, buildQuery);
}

/**
 * Get a single lead by ID with full detail.
 */
export async function getLeadById(
  orgId: string,
  userId: string,
  leadId: string,
) {
  return withOrgTx(orgId, userId, async (tx) => {
    const [lead] = await tx`
      SELECT ml.*,
             ls.name   AS status_name,
             lfr.name  AS fail_reason_name,
             ac.name   AS campaign_name,
             mp.name   AS platform_name,
             u.full_name AS assigned_rep_name,
             ci.name   AS city_name,
             st.name   AS state_name,
             co.name   AS country_name
      FROM marketing_leads ml
      JOIN lead_statuses ls ON ls.id = ml.status_id
      LEFT JOIN lead_fail_reasons lfr ON lfr.id = ml.fail_reason_id
      LEFT JOIN ad_campaigns ac ON ac.id = ml.campaign_id
      LEFT JOIN marketing_platforms mp ON mp.id = ac.platform_id
      LEFT JOIN users u ON u.id = ml.assigned_user_id
      LEFT JOIN cities ci ON ci.id = ml.city_id
      LEFT JOIN states st ON st.id = ml.state_id
      LEFT JOIN countries co ON co.id = ml.country_id
      WHERE ml.id = ${leadId} AND ml.org_id = ${orgId} AND NOT ml.is_deleted
    `;
    return lead ?? null;
  });
}

/**
 * Create a new lead.
 *
 * Duplicate resolution:
 *  - If phone/email matches an existing DIGITAL lead (campaign_id IS NOT NULL)
 *    in the same org → create the walk-in but link it via duplicate_lead_id
 *    (first/oldest matching digital lead wins).
 *  - If phone/email matches an existing non-digital (walk-in/organic) lead
 *    → throw { field: 'phone'|'email' } so the caller returns 409.
 */
export async function createLead(orgId: string, userId: string, data: any) {
  return withOrgTx(orgId, userId, async (tx) => {
    const [statusRow] =
      await tx`SELECT id FROM lead_statuses WHERE name = 'new'`;
    if (!statusRow) throw new Error('Lead status "new" not found in lookup table');

    // duplicateLeadId is resolved below; null means no digital match found.
    let duplicateLeadId: string | null = null;

    if (data.phone) {
      const [existing] = await tx`
        SELECT id, campaign_id FROM marketing_leads
        WHERE org_id = ${orgId} AND phone = ${data.phone} AND NOT is_deleted
        ORDER BY created_at ASC
        LIMIT 1
      `;
      if (existing) {
        if (existing.campaign_id) {
          duplicateLeadId = String(existing.id);
        } else {
          throw Object.assign(new Error('Duplicate phone'), { field: 'phone' });
        }
      }
    }

    if (data.email && !duplicateLeadId) {
      const [existing] = await tx`
        SELECT id, campaign_id FROM marketing_leads
        WHERE org_id = ${orgId} AND email = ${data.email} AND NOT is_deleted
        ORDER BY created_at ASC
        LIMIT 1
      `;
      if (existing) {
        if (existing.campaign_id) {
          duplicateLeadId = String(existing.id);
        } else {
          throw Object.assign(new Error('Duplicate email'), { field: 'email' });
        }
      }
    }

    const [result] = await tx`
      INSERT INTO marketing_leads
        (org_id, first_name, middle_name, last_name, phone, email,
         campaign_id, status_id, raw_webhook_data, metadata, tags,
         city_id, state_id, country_id, address_line1, pincode,
         assigned_user_id, duplicate_lead_id)
      VALUES
        (${orgId},
         ${data.firstName},
         ${data.middleName ?? null},
         ${data.lastName ?? null},
         ${data.phone ?? null},
         ${data.email ?? null},
         ${data.campaignId ?? null},
         ${statusRow.id},
         ${data.rawWebhookData ?? {}},
         ${data.metadata ?? {}},
         ${data.tags ?? []},
         ${data.cityId ?? null},
         ${data.stateId ?? null},
         ${data.countryId ?? null},
         ${data.addressLine1 ?? null},
         ${data.pincode ?? null},
         ${data.assignedUserId ?? null},
         ${duplicateLeadId})
      RETURNING id
    `;
    return result;
  });
}

/**
 * Create a lead bypassing RLS (for intake/webhook usage).
 */
export async function createLeadAsService(orgId: string, data: any) {
  return withServiceTx(async (tx) => {
    const rows = await tx.unsafe(
      `SELECT id FROM lead_statuses WHERE name = 'new' LIMIT 1`,
    );
    const statusRow = rows[0] as { id: number } | undefined;
    if (!statusRow) throw new Error('Lead status "new" not found in lookup table');

    const result = await tx.unsafe(
      `INSERT INTO marketing_leads
         (org_id, first_name, middle_name, last_name, phone, email,
          campaign_id, status_id, raw_webhook_data, metadata, tags,
          city_id, state_id, country_id, address_line1, pincode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id`,
      [
        orgId, data.firstName, data.middleName ?? null, data.lastName ?? null,
        data.phone ?? null, data.email ?? null, data.campaignId ?? null,
        statusRow.id, JSON.stringify(data.rawWebhookData ?? {}),
        JSON.stringify(data.metadata ?? {}), data.tags ?? [],
        data.cityId ?? null, data.stateId ?? null, data.countryId ?? null,
        data.addressLine1 ?? null, data.pincode ?? null,
      ],
    );
    return (result as any[])[0];
  });
}

/**
 * Update lead status, assignment, or metadata.
 */
export async function updateLead(
  orgId: string,
  userId: string,
  leadId: string,
  data: any,
) {
  return withOrgTx(orgId, userId, async (tx) => {
    if (data.assignedUserId !== undefined) {
      const [allowed] = await tx`
        SELECT can_assign_to(${orgId}::uuid, ${userId}::uuid, ${data.assignedUserId}::uuid) AS allowed
      `;
      if (!allowed?.allowed)
        throw new Error("Insufficient hierarchy authority to assign this lead");
    }

    if (data.statusId !== undefined) {
      const [statusRow] =
        await tx`SELECT name FROM lead_statuses WHERE id = ${data.statusId}`;
      if (statusRow?.name === "failed" && !data.failReasonId) {
        throw new Error(
          "A fail reason must be selected when marking a lead as failed.",
        );
      }
    }

    const updates: Record<string, unknown> = {};
    if (data.statusId !== undefined) updates.status_id = data.statusId;
    if (data.failReasonId !== undefined) updates.fail_reason_id = data.failReasonId;
    if (data.assignedUserId !== undefined) updates.assigned_user_id = data.assignedUserId;
    if (data.metadata !== undefined) updates.metadata = data.metadata;
    if (data.tags !== undefined) updates.tags = data.tags;

    if (Object.keys(updates).length === 0) return null;

    const [result] = await tx`
      UPDATE marketing_leads
      SET ${tx(updates)}
      WHERE id = ${leadId} AND org_id = ${orgId} AND NOT is_deleted
      RETURNING id
    `;
    if (!result) return null;

    // When a note accompanies any field change, log it as an internal_note interaction
    if (data.transitionNote?.trim()) {
      const [itRow] = await tx`
        SELECT id FROM interaction_types WHERE name = 'internal_note' LIMIT 1
      `;
      if (itRow) {
        await tx`
          INSERT INTO lead_interactions
            (org_id, lead_id, user_id, interaction_type_id, notes, occurred_at)
          VALUES
            (${orgId}, ${leadId}, ${userId}, ${itRow.id},
             ${data.transitionNote.trim()}, NOW())
        `;
      }
    }

    return result;
  });
}

/**
 * Soft-delete a lead.
 */
export async function deleteLead(
  orgId: string,
  userId: string,
  leadId: string,
) {
  return withOrgTx(orgId, userId, async (tx) => {
    await tx`DELETE FROM marketing_leads WHERE id = ${leadId} AND org_id = ${orgId}`;
  });
}
