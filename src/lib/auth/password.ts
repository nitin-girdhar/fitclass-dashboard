/**
 * Password hashing & verification.
 *
 * SERVER-ONLY. Never call these from client code — raw passwords must never
 * leave the server boundary, and the hashing cost would block the UI thread.
 *
 * Why hashing (and never plaintext):
 *  - A database leak must not expose usable credentials. Storing plaintext (or
 *    reversible encryption) means one breach compromises every account and,
 *    given password reuse, accounts on other systems too.
 *  - bcrypt is a deliberately *slow*, salted, adaptive hash. The per-hash salt
 *    defeats rainbow tables; the tunable cost factor lets us scale difficulty
 *    as hardware gets faster.
 *
 * Cost factor (salt rounds): 12 is the current sensible default — strong
 * against offline brute force while keeping server login latency acceptable
 * (~tens of ms). Bump it over time as CPUs get faster; existing hashes remain
 * verifiable because the cost is encoded in the hash string itself.
 */
import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';

if (!process.env.BCRYPT_ROUNDS) throw new Error('BCRYPT_ROUNDS env var is not set');
const SALT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10);

/** Hash a plaintext password. The result embeds algorithm, cost and salt. */
export async function hashPassword(plain: string): Promise<string> {
  if (!plain) {
    throw new Error('[password] Cannot hash an empty password');
  }
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * Constant-time comparison of a candidate password against a stored hash.
 * Returns false (never throws) for malformed/empty input so callers can treat
 * it as a plain auth failure without leaking error detail.
 */
export async function comparePassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  if (!plain || !hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * Generate a temporary password that satisfies the strength policy:
 *   4 uppercase hex chars + 4 lowercase hex chars + '@1'
 *
 * The '@1' suffix guarantees the policy requirements (uppercase ✓, lowercase ✓,
 * digit ✓, special char ✓) regardless of random output.
 * The caller is responsible for marking force_password_change = true so the
 * user replaces this on first login.
 */
export function generateTemporaryPassword(): string {
  return (
    randomBytes(6).toString('hex').toUpperCase().slice(0, 4) +
    randomBytes(6).toString('hex').slice(0, 4) +
    '@1'
  );
}
