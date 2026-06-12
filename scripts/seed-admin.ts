/**
 * Idempotent first-admin seed.
 *
 * Run: `npm run db:seed-admin`  (loads .env.local, executes via tsx)
 *
 * Behaviour:
 *  - Validates seed env vars up front with a clear error if missing.
 *  - Idempotent: if a user with SEED_ADMIN_EMAIL already exists, it does
 *    NOTHING (no overwrite, no password reset) and exits 0. Safe to run
 *    repeatedly / in CI / on every deploy.
 *  - Hashes the password with the shared bcrypt helper — plaintext is never
 *    stored and never logged (logging prints email + role only).
 *
 * SERVER/CLI ONLY. Uses supabaseAdmin (service role).
 */
import { z } from 'zod';
import { hashPassword } from '@/src/lib/auth/password';
import { getUserByEmail } from '@/src/features/users/queries';
import { createUser } from '@/src/features/users/mutations';
import { isDatabaseError } from '@/src/lib/db/errors';

const seedSchema = z.object({
  SEED_ADMIN_EMAIL: z.email('SEED_ADMIN_EMAIL must be a valid email'),
  SEED_ADMIN_PASSWORD: z
    .string()
    .min(10, 'SEED_ADMIN_PASSWORD must be at least 10 characters'),
  SEED_ADMIN_NAME: z.string().min(1).default('FitClass Admin'),
});

async function main(): Promise<void> {
  const parsed = seedSchema.safeParse({
    SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL,
    SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD,
    SEED_ADMIN_NAME: process.env.SEED_ADMIN_NAME,
  });

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  • ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    console.error(
      `[seed-admin] Missing/invalid seed env vars:\n${issues}\n` +
        `Set SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD (and optional ` +
        `SEED_ADMIN_NAME) in .env.local.`,
    );
    process.exit(1);
  }

  const { SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD, SEED_ADMIN_NAME } = parsed.data;
  const email = SEED_ADMIN_EMAIL.trim().toLowerCase();

  const existing = await getUserByEmail(email);
  if (existing) {
    console.log(
      `[seed-admin] User already exists (email=${email}, role=${existing.role}). ` +
        `No changes made.`,
    );
    return;
  }

  const password_hash = await hashPassword(SEED_ADMIN_PASSWORD);
  const created = await createUser({
    name: SEED_ADMIN_NAME,
    email,
    password_hash,
    role: 'admin',
    is_active: true,
  });

  console.log(
    `[seed-admin] Created admin user (id=${created.id}, email=${created.email}, ` +
      `role=${created.role}).`,
  );
}

main().catch((err: unknown) => {
  if (isDatabaseError(err)) {
    console.error(`[seed-admin] Database error (${err.kind}): ${err.message}`);
  } else if (err instanceof Error) {
    console.error(`[seed-admin] Failed: ${err.message}`);
  } else {
    console.error('[seed-admin] Failed with unknown error');
  }
  process.exit(1);
});
