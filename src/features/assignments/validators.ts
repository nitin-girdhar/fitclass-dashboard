/**
 * Zod schemas for the /api/assignments endpoints.
 *
 * Reuses the canonical lead-id format from `./lead-id.ts` — the schema
 * doesn't try to parse it (the API handler resolves the branch from the
 * client-supplied `branch` field, then cross-checks the actor's access).
 */
import { z } from 'zod';

const uuid = z.uuid('Must be a valid UUID');
const nonEmpty = (label: string) =>
  z.string().trim().min(1, `${label} is required`).max(200);

export const createAssignmentSchema = z.object({
  lead_id: nonEmpty('lead_id'),
  branch: nonEmpty('branch'),
  assigned_to: uuid,
  notes: z.string().trim().max(2000).optional().nullable(),
});

export const updateAssignmentSchema = z.object({
  assigned_to: uuid,
  notes: z.string().trim().max(2000).optional().nullable(),
});

export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>;
export type UpdateAssignmentInput = z.infer<typeof updateAssignmentSchema>;
