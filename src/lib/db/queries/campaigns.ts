/**
 * Campaign queries — CRUD operations on ad_campaigns.
 */
import { withOrgTx } from "../transaction";
import { resolveLookupId } from "./lookups";
import type { Campaign } from "@/src/types/db";

/**
 * Get all campaigns for an org.
 */
export async function getCampaigns(orgId: string, userId: string) {
  return withOrgTx(orgId, userId, async (tx) => {
    return tx`
      SELECT ac.*, mp.label as platform_name, cs.name as status_name,
             COUNT(ml.id) FILTER (WHERE NOT ml.is_deleted) as lead_count
      FROM ad_campaigns ac
      JOIN marketing_platforms mp ON mp.id = ac.platform_id
      JOIN campaign_statuses cs ON cs.id = ac.status_id
      LEFT JOIN marketing_leads ml ON ml.campaign_id = ac.id
      WHERE ac.org_id = ${orgId} AND NOT ac.is_deleted
      GROUP BY ac.id, mp.label, cs.name
      ORDER BY ac.created_at DESC
    `;
  });
}

/**
 * Get a single campaign by ID.
 */
export async function getCampaignById(
  orgId: string,
  userId: string,
  campaignId: string,
) {
  return withOrgTx(orgId, userId, async (tx) => {
    const [campaign] = await tx`
      SELECT ac.*, mp.label as platform_name, cs.name as status_name
      FROM ad_campaigns ac
      JOIN marketing_platforms mp ON mp.id = ac.platform_id
      JOIN campaign_statuses cs ON cs.id = ac.status_id
      WHERE ac.id = ${campaignId} AND ac.org_id = ${orgId} AND NOT ac.is_deleted
    `;
    return campaign || null;
  });
}

/**
 * Create a new campaign.
 */
export async function createCampaign(orgId: string, userId: string, data: any) {
  return withOrgTx(orgId, userId, async (tx) => {
    const platformId = await resolveLookupId(
      "marketing_platforms",
      data.platformName,
    );
    const statusId = await resolveLookupId(
      "campaign_statuses",
      data.statusName || "draft",
    );

    const [result] = await tx`
      INSERT INTO ad_campaigns
        (org_id, name, platform_id, status_id, budget, started_at, ended_at)
      VALUES
        (${orgId}, ${data.name}, ${platformId}, ${statusId}, ${data.budget ?? null},
         ${data.startDate ?? null}, ${data.endDate ?? null})
      RETURNING id
    `;
    return result;
  });
}

/**
 * Update a campaign.
 */
export async function updateCampaign(
  orgId: string,
  userId: string,
  campaignId: string,
  data: any,
) {
  return withOrgTx(orgId, userId, async (tx) => {
    const updates: any = {};

    if (data.name !== undefined) updates.name = data.name;
    if (data.platformName !== undefined)
      updates.platform_id = await resolveLookupId(
        "marketing_platforms",
        data.platformName,
      );
    if (data.statusName !== undefined)
      updates.status_id = await resolveLookupId(
        "campaign_statuses",
        data.statusName,
      );
    if (data.budget !== undefined) updates.budget = data.budget;
    if (data.startDate !== undefined) updates.started_at = data.startDate;
    if (data.endDate !== undefined) updates.ended_at = data.endDate;

    if (Object.keys(updates).length === 0) return null;

    const [result] = await tx`
      UPDATE ad_campaigns 
      SET ${tx(updates)}
      WHERE id = ${campaignId} AND org_id = ${orgId} AND NOT is_deleted
      RETURNING id
    `;
    return result;
  });
}

/**
 * Soft-delete a campaign.
 */
export async function deleteCampaign(
  orgId: string,
  userId: string,
  campaignId: string,
) {
  return withOrgTx(orgId, userId, async (tx) => {
    await tx`DELETE FROM ad_campaigns WHERE id = ${campaignId} AND org_id = ${orgId}`;
  });
}
