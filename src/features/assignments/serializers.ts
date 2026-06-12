/**
 * DB row → app-facing assignment view. Pure projection.
 *
 * Phase 2U: the view now carries denormalised assignee identity
 * (`assignee_name`, `assignee_email`) so the UI never has to fall back to
 * displaying the raw `assigned_to` UUID when the assignee isn't in the
 * caller's candidate list. The denormalised fields come from a single
 * PostgREST `users` embed at query time — see queries.ts. No N+1.
 *
 * The denormalised fields are READ-OPTIMISED, not stored: they're computed
 * fresh on every SELECT, so a user rename is reflected on next fetch.
 */
import type { Assignment } from '@/src/types/database';

/**
 * Shape of the optional embedded user row that PostgREST returns when the
 * SELECT clause includes `assignee:users!assigned_to(name, email)`.
 * Kept loose because rejecting the row when the embed is missing would
 * lose us the assignment id (the FK is NOT NULL so the embed always
 * resolves in practice, but the type stays optional for safety).
 */
export interface EmbeddedAssignee {
  name: string | null;
  email: string;
}

export type AssignmentRowWithAssignee = Assignment & {
  assignee?: EmbeddedAssignee | null;
  lead_name?: string | null;
  lead_phone?: string | null;
  duplicate_lead_id?: string | null;
  duplicate_lead_platform?: string | null;
};

export interface AssignmentView {
  id: string;
  lead_id: string;
  lead_name: string | null;
  lead_phone: string | null;
  branch: string;
  assigned_to: string;
  assigned_by: string;
  assigned_at: string;
  notes: string | null;
  /** Denormalised at query time so the UI never renders a raw UUID. */
  assignee_name: string | null;
  assignee_email: string | null;
  /** Set when the walk-in matched an existing digital (campaign-sourced) lead. */
  duplicate_lead_id: string | null;
  /** Platform name of the matched digital lead (e.g. "facebook", "google"). */
  duplicate_lead_platform: string | null;
}

export function toAssignmentView(row: AssignmentRowWithAssignee): AssignmentView {
  return {
    id: row.id,
    lead_id: row.lead_id,
    lead_name: row.lead_name ?? null,
    lead_phone: row.lead_phone ?? null,
    branch: row.branch,
    assigned_to: row.assigned_to,
    assigned_by: row.assigned_by,
    assigned_at: row.assigned_at,
    notes: row.notes,
    assignee_name: row.assignee?.name ?? null,
    assignee_email: row.assignee?.email ?? null,
    duplicate_lead_id:       row.duplicate_lead_id       ?? null,
    duplicate_lead_platform: row.duplicate_lead_platform ?? null,
  };
}

export function toAssignmentViews(rows: AssignmentRowWithAssignee[]): AssignmentView[] {
  return rows.map(toAssignmentView);
}

/**
 * Render helper — the single answer to "what string do I show for this
 * assignee?". Used by every chip / badge / dropdown so the rules don't
 * drift across surfaces.
 */
export function assigneeDisplayLabel(a: AssignmentView): string {
  return a.assignee_name ?? a.assignee_email ?? 'Unknown user';
}
