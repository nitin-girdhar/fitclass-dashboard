/**
 * User-management input schemas.
 *
 * Separate from `src/lib/validations/auth.ts`:
 *  - `validations/auth.ts` is the *self-service* schema (login + a generic
 *    create with password). Reused by the login form.
 *  - This file is the *admin-side* schema. Admins don't type passwords —
 *    the server generates a temporary one on create / reset and returns it
 *    once for out-of-band sharing. So no `password` field appears here.
 *
 * `branchValuesSchema` is shared so the admin can't sneak in arbitrary
 * sheet names or extreme strings.
 */
import { z } from 'zod';
import { ROLES } from '@/src/features/auth/constants';

// A single sheet-tab name. Constraints chosen to match how Google Sheets
// tab names look in this CRM (short-ish, no surrounding whitespace).
const branchNameSchema = z
  .string()
  .trim()
  .min(1, 'Branch name cannot be empty')
  .max(80, 'Branch name is too long');

const branchListSchema = z
  .array(branchNameSchema)
  .max(50, 'Too many branches')
  // Dedupe while preserving order.
  .transform((arr) => Array.from(new Set(arr)));

/** Admin → Create user. Password is generated server-side. */
export const adminCreateUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email: z.email('Enter a valid email').trim().toLowerCase(),
  role: z.enum(ROLES),
  allowed_branches: branchListSchema.default([]),
});

/** Admin → Update user. Every field optional; at least one required. */
export const adminUpdateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    role: z.enum(ROLES).optional(),
    allowed_branches: branchListSchema.optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.role !== undefined ||
      v.allowed_branches !== undefined ||
      v.is_active !== undefined,
    { message: 'No fields to update' },
  );

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
