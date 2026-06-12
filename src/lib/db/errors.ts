/**
 * Standardised database error handling.
 *
 * SERVER-ONLY. Wraps the loosely-typed Supabase/PostgREST error shape into a
 * single typed `DatabaseError` with a stable `kind` discriminant, so callers
 * branch on intent ("unique violation", "not found") instead of pg codes
 * scattered across the codebase. Never leaks raw SQL/driver detail to clients.
 */
import type { PostgrestError } from '@supabase/supabase-js';

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
 * Normalise a PostgrestError into a DatabaseError. Use at every Supabase call
 * site: `if (error) throw fromPostgrestError(error);`
 */
export function fromPostgrestError(error: PostgrestError): DatabaseError {
  const kind = kindFromPgCode(error.code);
  // Keep the human message generic; details stay in server logs via `code`.
  const message =
    kind === 'unique_violation'
      ? 'A record with these unique values already exists'
      : kind === 'foreign_key_violation'
        ? 'Referenced record does not exist'
        : error.message || 'Database operation failed';
  return new DatabaseError(kind, message, error.code ?? null);
}

/** Explicit not-found helper for query-by-id/email paths. */
export function notFound(entity: string): DatabaseError {
  return new DatabaseError('not_found', `${entity} not found`);
}

/** Type guard for ergonomic `catch` handling. */
export function isDatabaseError(err: unknown): err is DatabaseError {
  return err instanceof DatabaseError;
}
