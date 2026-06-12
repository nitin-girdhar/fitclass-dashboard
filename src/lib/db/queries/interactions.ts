/**
 * Interaction queries — CRUD operations on lead_interactions.
 */
import { withOrgTx } from "../transaction";
import { resolveLookupId } from "./lookups";
import type { Interaction } from "@/src/types/db";

/**
 * Get interactions for a lead.
 */
export async function getInteractionsByLead(
  orgId: string,
  userId: string,
  leadId: string,
) {
  return withOrgTx(orgId, userId, async (tx) => {
    return tx`
      SELECT li.*, it.name as interaction_type, u.full_name as user_name
      FROM lead_interactions li
      JOIN interaction_types it ON it.id = li.interaction_type_id
      JOIN users u ON u.id = li.user_id
      WHERE li.lead_id = ${leadId} AND li.org_id = ${orgId} AND NOT li.is_deleted
      ORDER BY li.occurred_at DESC
    `;
  });
}

/**
 * Create a new interaction.
 */
export async function createInteraction(
  orgId: string,
  userId: string,
  leadId: string,
  data: any,
) {
  return withOrgTx(orgId, userId, async (tx) => {
    const interactionTypeId = await resolveLookupId(
      "interaction_types",
      data.interactionTypeName,
    );

    const [result] = await tx`
      INSERT INTO lead_interactions 
        (org_id, lead_id, user_id, interaction_type_id, notes, duration_seconds, occurred_at)
      VALUES 
        (${orgId}, ${leadId}, ${userId}, ${interactionTypeId}, 
         ${data.notes ?? null}, ${data.durationSeconds ?? null}, 
         ${data.occurredAt ?? new Date()})
      RETURNING id
    `;
    return result;
  });
}

/**
 * Soft-delete an interaction (no update, just delete).
 */
export async function deleteInteraction(
  orgId: string,
  userId: string,
  interactionId: string,
) {
  return withOrgTx(orgId, userId, async (tx) => {
    await tx`DELETE FROM lead_interactions WHERE id = ${interactionId} AND org_id = ${orgId}`;
  });
}
