/**
 * Centralised environment-variable validation.
 *
 * SERVER-ONLY. This module reads server secrets (service role key, JWT secret)
 * and must never be imported into client components or Edge middleware.
 *
 * Why a single validated module:
 *  - One place fails loudly (with a precise message) if config is missing,
 *    instead of `undefined` propagating into crypto/db calls and producing
 *    confusing runtime errors deep in the stack.
 *  - Downstream code consumes a strongly-typed, guaranteed-present object —
 *    no `process.env.X!` non-null assertions, no `any`.
 *  - Validation runs once at module load (first import), then memoised.
 */
import { z } from 'zod';

const envSchema = z.object({
  // Required for all auth providers.
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters of high-entropy randomness'),

  // Required only when AUTH_PROVIDER=supabase.
  NEXT_PUBLIC_SUPABASE_URL: z.url(
    'NEXT_PUBLIC_SUPABASE_URL must be a valid URL (https://<project>.supabase.co)',
  ).optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | null = null;

/**
 * Validate and return the server environment. Throws a descriptive,
 * aggregated error listing every missing/invalid variable at once.
 */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = envSchema.safeParse({
    JWT_SECRET: process.env.JWT_SECRET,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `[env] Invalid or missing environment variables:\n${issues}\n` +
        `Copy .env.local.example to .env.local and fill in the values.`,
    );
  }

  cached = parsed.data;
  return cached;
}
