/**
 * Zod validation schemas for auth inputs.
 *
 * Only the login schema lives here. User-creation validation lives in
 * src/features/users/validators.ts (admin-side) and the API route itself
 * (src/app/api/users/route.ts) which owns the firstName/lastName shape
 * that matches the DB table.
 *
 * Edge/runtime-agnostic (zod only) — safe to import anywhere.
 */
import { z } from 'zod';

/** Login: just enough to authenticate. Keep messages user-safe (no internals). */
export const loginSchema = z.object({
  email: z.email('Enter a valid email address').trim().toLowerCase(),
  password: z
    .string()
    .min(1, 'Password is required')
    .max(128, 'Password is too long'),
});

export type LoginInput = z.infer<typeof loginSchema>;
