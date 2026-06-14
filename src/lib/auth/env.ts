/**
 * Centralised environment-variable validation.
 *
 * SERVER-ONLY. Reads server secrets (JWT_SECRET) and must never be imported
 * into client components or Edge middleware.
 *
 * Validation runs once at module load (first import), then memoised.
 */
import { z } from 'zod';

const envSchema = z.object({
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters of high-entropy randomness'),
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
