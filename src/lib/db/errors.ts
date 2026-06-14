/**
 * Standardised database error handling.
 *
 * SERVER-ONLY. Wraps postgres.js errors into a single typed DatabaseError
 * with a stable `kind` discriminant, so callers branch on intent
 * ("unique violation", "not found") instead of SQLSTATE codes scattered
 * across the codebase. Never leaks raw SQL/driver detail to clients.
 */

export type DatabaseErrorKind =
  | 'unique_violation' // 23505
  | 'foreign_key_violation' // 23503
  | 'not_found'
  | 'unknown';

export class DatabaseError extends Error {
  readonly kind: DatabaseErrorKind;
  /** Raw pg SQLSTATE code when available — for server logs only. */
  readonly code: string | null;

  constructor(kind: DatabaseErrorKind, message: string, code: string | null = null) {
    super(message);
    this.name = 'DatabaseError';
    this.kind = kind;
    this.code = code;
  }
}

function kindFromPgCode(code: string | undefined): DatabaseErrorKind {
  switch (code) {
    case '23505':
      return 'unique_violation';
    case '23503':
      return 'foreign_key_violation';
    default:
      return 'unknown';
  }
}

/**
 * Normalise a postgres.js error (or any object carrying a SQLSTATE `code`)
 * into a DatabaseError. Unique/FK violations produce typed kinds; everything
 * else becomes 'unknown'. Non-object throws are re-wrapped so callers always
 * receive a DatabaseError at a catch site after a DB call.
 */
export function fromPgError(err: unknown): DatabaseError {
  if (err != null && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') {
      const kind = kindFromPgCode(code);
      const message =
        kind === 'unique_violation'
          ? 'A record with these unique values already exists'
          : kind === 'foreign_key_violation'
            ? 'Referenced record does not exist'
            : 'message' in err
              ? String((err as { message: unknown }).message)
              : 'Database operation failed';
      return new DatabaseError(kind, message, code);
    }
  }
  const message = err instanceof Error ? err.message : String(err);
  return new DatabaseError('unknown', message);
}

/** Explicit not-found helper for query-by-id/email paths. */
export function notFound(entity: string): DatabaseError {
  return new DatabaseError('not_found', `${entity} not found`);
}

/** Type guard for ergonomic `catch` handling. */
export function isDatabaseError(err: unknown): err is DatabaseError {
  return err instanceof DatabaseError;
}
