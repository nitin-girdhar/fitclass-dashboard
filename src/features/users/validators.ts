/**
 * User-management input schemas (admin-side and self-service password changes).
 *
 * User *creation* is validated in app/api/users/route.ts because the DB schema
 * uses first_name / middle_name / last_name columns (not a single name field).
 * Keeping the schema co-located with the route avoids the historical bug where
 * an old single-`name` schema accepted requests that then failed the NOT NULL
 * constraint on first_name.
 *
 * `strongPasswordSchema` is exported so app/api/users/[id]/reset-password can
 * reuse the same strength policy without duplicating regex.
 */
import { z } from 'zod';

/**
 * Password strength policy (shared by admin-set + self-service change).
 *   min 8 · ≥1 lowercase · ≥1 uppercase · ≥1 digit · symbols allowed (optional)
 * The regexes are positive look-aheads so a single field surfaces the first
 * unmet rule as its message.
 */
const strongPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[0-9]/, 'Password must include a number');

/**
 * Admin → manually SET a user's password. The admin types the password
 * (no server generation). `confirm` must match — checked here so the API
 * rejects a mismatch even if the UI is bypassed.
 */
export const adminSetPasswordSchema = z
  .object({
    password: strongPasswordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

/**
 * Self-service change. Requires the current password (anti-CSRF / anti-
 * shoulder-surf: a stolen session alone can't silently rotate the password)
 * plus a new one meeting the strength policy.
 */
export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'Current password is required'),
    new_password: strongPasswordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.new_password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  })
  .refine((v) => v.new_password !== v.current_password, {
    message: 'New password must differ from the current one',
    path: ['new_password'],
  });

export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;
export type AdminSetPasswordInput = z.infer<typeof adminSetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
