/**
 * Assignment WRITE layer. SERVER-ONLY.
 *
 * Assignments live on marketing_leads.assigned_user_id — there is no
 * separate `assignments` table. The "assignment id" == marketing_lead.id.
 *
 * Each helper performs the DB mutation AND emits the matching audit row.
 * Audit writes cannot fail the business operation (errors are swallowed
 * inside the log helpers themselves).
 */
import { withServiceTx } from '@/src/lib/db/transaction';
import { fromPgError, DatabaseError, notFound } from '@/src/lib/db/errors';
import type { Assignment } from '@/src/types/database';
import type { AssignmentRowWithAssignee } from './serializers';
import {
  logAssignmentCreated,
  logAssignmentReassigned,
  logAssignmentRemoved,
} from '@/src/features/activities/mutations';

// ── Shared fetch helper ───────────────────────────────────────────────────────

async function fetchAssignedLead(
  tx: any,
  leadId: string,
): Promise<AssignmentRowWithAssignee | null> {
  const rows = await tx.unsafe(
    `SELECT
       ml.id                                          AS id,
       ml.id                                          AS lead_id,
       ml.full_name                                   AS lead_name,
       ml.phone                                       AS lead_phone,
       COALESCE(o.name, '')                           AS branch,
       ml.assigned_user_id::text                     AS assigned_to,
       ''                                             AS assigned_by,
       COALESCE(ml.updated_at, ml.created_at)::text  AS assigned_at,
       NULL::text                                     AS notes,
       u.full_name                                    AS assignee_name,
       u.email                                        AS assignee_email
     FROM marketing_leads ml
     JOIN users u ON u.id = ml.assigned_user_id
     LEFT JOIN organizations o ON o.id = ml.org_id
     WHERE ml.id = $1::uuid AND ml.assigned_user_id IS NOT NULL AND NOT ml.is_deleted
     LIMIT 1`,
    [leadId],
  );

  if (!rows.length) return null;
  const r = rows[0] as any;
  return {
    id:          r.id          as string,
    lead_id:     r.lead_id     as string,
    lead_name:   (r.lead_name  ?? null) as string | null,
    lead_phone:  (r.lead_phone ?? null) as string | null,
    branch:      r.branch      as string,
    assigned_to: r.assigned_to as string,
    assigned_by: ''            as string,
    assigned_at: String(r.assigned_at ?? ''),
    notes:       null,
    duplicate_lead_id:       null,
    duplicate_lead_platform: null,
    assignee: {
      name:  (r.assignee_name  ?? null) as string | null,
      email: (r.assignee_email ?? '')   as string,
    },
  };
}

// ── Mutations ─────────────────────────────────────────────────────────────────

interface AssignLeadInput {
  leadId: string;
  branch: string;
  assignedTo: string;
  assignedBy: string;
  notes?: string | null;
}

/**
 * Assign a lead that currently has no owner. Throws unique_violation if the
 * lead is already assigned (caller surfaces 409 + suggests reassignLead).
 */
export async function assignLead(
  input: AssignLeadInput,
): Promise<AssignmentRowWithAssignee> {
  return withServiceTx(async (tx) => {
    try {
      // Atomic CAS: only succeeds when assigned_user_id IS NULL
      const updated = await tx.unsafe(
        `UPDATE marketing_leads
         SET assigned_user_id = $1::uuid, updated_at = CLOCK_TIMESTAMP()
         WHERE id = $2::uuid AND assigned_user_id IS NULL AND NOT is_deleted
         RETURNING id`,
        [input.assignedTo, input.leadId],
      );

      if (!updated.length) {
        // Distinguish "not found" from "already assigned"
        const [existing] = await tx.unsafe(
          `SELECT assigned_user_id
           FROM marketing_leads
           WHERE id = $1::uuid AND NOT is_deleted LIMIT 1`,
          [input.leadId],
        );
        if (!existing) throw notFound('Lead');
        throw new DatabaseError(
          'unique_violation',
          'A record with these unique values already exists',
        );
      }

      const row = await fetchAssignedLead(tx, input.leadId);
      if (!row) throw notFound('Lead assignment');

      await logAssignmentCreated(input.assignedBy, input.leadId, {
        assignment_id: row.id,
        branch: row.branch,
        assigned_to: row.assigned_to,
        notes: null,
      });

      return row;
    } catch (err) {
      if (err instanceof DatabaseError) throw err;
      throw fromPgError(err);
    }
  });
}

interface ReassignInput {
  /** marketing_lead.id (= assignment id in current schema). */
  id: string;
  assignedTo: string;
  actorId: string;
  notes?: string | null;
}

/**
 * Reassign an existing assignment to a new owner. Keeps the same lead id so
 * all external references (audit rows, UI) remain stable.
 */
export async function reassignLead(
  input: ReassignInput,
): Promise<AssignmentRowWithAssignee> {
  return withServiceTx(async (tx) => {
    try {
      const before = await fetchAssignedLead(tx, input.id);
      if (!before) throw notFound('Assignment');

      await tx.unsafe(
        `UPDATE marketing_leads
         SET assigned_user_id = $1::uuid, updated_at = CLOCK_TIMESTAMP()
         WHERE id = $2::uuid AND NOT is_deleted`,
        [input.assignedTo, input.id],
      );

      const after = await fetchAssignedLead(tx, input.id);
      if (!after) throw notFound('Lead assignment');

      await logAssignmentReassigned(
        input.actorId,
        after.lead_id,
        {
          assignment_id: before.id,
          assigned_to: before.assigned_to,
          assigned_by: before.assigned_by,
        },
        {
          assignment_id: after.id,
          assigned_to: after.assigned_to,
          assigned_by: after.assigned_by,
        },
      );

      return after;
    } catch (err) {
      if (err instanceof DatabaseError) throw err;
      throw fromPgError(err);
    }
  });
}

interface UnassignInput {
  id: string;
  actorId: string;
}

/**
 * Unassign a lead (set assigned_user_id = NULL). Lead returns to "unowned".
 * Audit row captures who/what was removed.
 */
export async function unassignLead(input: UnassignInput): Promise<void> {
  return withServiceTx(async (tx) => {
    try {
      const before = await fetchAssignedLead(tx, input.id);
      if (!before) throw notFound('Assignment');

      await tx.unsafe(
        `UPDATE marketing_leads
         SET assigned_user_id = NULL, updated_at = CLOCK_TIMESTAMP()
         WHERE id = $1::uuid AND NOT is_deleted`,
        [input.id],
      );

      await logAssignmentRemoved(input.actorId, before.lead_id, {
        assignment_id: before.id,
        branch: before.branch,
        assigned_to: before.assigned_to,
        notes: null,
      });
    } catch (err) {
      if (err instanceof DatabaseError) throw err;
      throw fromPgError(err);
    }
  });
}

// Exported for callers that need the bare DB shape.
export type { Assignment };
