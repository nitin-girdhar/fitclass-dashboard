/**
 * Zod validation schemas for auth inputs.
 *
 * Single source of truth for "what valid input looks like" — reused by the
 * future login/create-user endpoints AND inferable into TS types so request
 * handlers never hand-roll validation or drift from the type layer.
 *
 * Edge/runtime-agnostic (zod only) — safe to import anywhere.
 */
import { z } from 'zod';
import { ROLES } from '@/src/features/auth/constants';

/** Login: just enough to authenticate. Keep messages user-safe (no internals). */
export const loginSchema = z.object({
  email: z.email('Enter a valid email address').trim().toLowerCase(),
  password: z
    .string()
    .min(1, 'Password is required')
    .max(128, 'Password is too long'),
});

/**
 * Admin-side user creation. Stronger password policy than login (login only
 * needs to match an existing hash; creation sets the bar for new credentials).
 */
export const createUserSchema = z.object({
  email: z.email('Enter a valid email address').trim().toLowerCase(),
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(120, 'Name is too long'),
  password: z
    .string()
    .min(10, 'Password must be at least 10 characters')
    .max(128, 'Password is too long')
    .regex(/[a-z]/, 'Password must include a lowercase letter')
    .regex(/[A-Z]/, 'Password must include an uppercase letter')
    .regex(/\d/, 'Password must include a number'),
  role: z.enum(ROLES),
});

/** Inferred input types — keep request handlers in lockstep with validation. */
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
