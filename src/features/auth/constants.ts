/**
 * Auth/RBAC constants — single source of truth.
 *
 * Pure, dependency-free, Edge-safe (imported by middleware). No `process.env`
 * reads, no Node APIs — keep it that way so the Edge bundle stays tiny.
 */

/**
 * Canonical role list matching PostgreSQL user_roles.name values.
 * ORDER MATTERS: index ascends with privilege level.
 *
 * PostgreSQL roles (new, used when AUTH_PROVIDER=local):
 *  - read_only              → view dashboard only
 *  - sales_rep              → individual contributor (was: sales_executive)
 *  - senior_sales_executive → higher-rank IC; may absorb leads from juniors
 *  - org_manager            → owns a branch; routes work to sales tier (was: manager)
 *  - org_admin              → full access within one org (was: admin)
 *  - tenant_admin           → cross-org tenant dashboard
 *  - super_admin            → platform-wide administration
 *
 * Legacy Supabase roles kept for backward compatibility (AUTH_PROVIDER=supabase):
 *  sales_executive, manager, admin
 */
export const ROLES = [
  'read_only',
  'sales_rep',
  'sales_executive',
  'senior_sales_executive',
  'org_manager',
  'manager',
  'org_sr_manager',
  'org_admin',
  'admin',
  'tenant_admin',
  'super_admin',
] as const;

/**
 * Canonical (PostgreSQL-native) roles only — no legacy Supabase aliases.
 * Use this for UI dropdowns so duplicate labels don't appear.
 * ROLES retains all names for type coverage and JWT decode compatibility.
 */
export const CANONICAL_ROLES = [
  'read_only',
  'sales_rep',
  'senior_sales_executive',
  'org_manager',
  'org_sr_manager',
  'org_admin',
  'tenant_admin',
  'super_admin',
] as const satisfies ReadonlyArray<(typeof ROLES)[number]>;

/**
 * Client-side role → rank lookup.
 *
 * Used ONLY to translate a role NAME string into a rank number where the
 * full SessionUser (with user.rank from the JWT) is not available — e.g.
 * filtering role dropdown options in RoleSelector, or computing the Supabase
 * fallback rank at login.
 *
 * Server-side permission checks must use `actor.rank` (from the JWT, sourced
 * from user_roles.rank in PostgreSQL) — NOT this constant. Rank changes in the
 * DB take effect at next login; no code changes needed.
 *
 * MIRRORS user_roles.rank — keep in sync when adding roles to the DB migration.
 */
export const ROLE_RANK: Record<(typeof ROLES)[number], number> = {
  read_only: 0,
  sales_rep: 20,
  sales_executive: 20,
  senior_sales_executive: 40,
  org_manager: 60,
  manager: 60,
  org_sr_manager: 70,
  org_admin: 80,
  admin: 80,
  tenant_admin: 90,
  super_admin: 100,
};

/**
 * Human labels for any place that renders a role to a user.
 *
 * MIRRORS user_roles.label in PostgreSQL (databse-model/02_lookup_tables.sql).
 * Keep in sync with the DB — the DB is the single source of truth for server-rendered
 * role names; this constant is for Edge / client code that cannot query the DB.
 */
export const ROLE_LABELS: Record<(typeof ROLES)[number], string> = {
  read_only: 'Read Only',
  sales_rep: 'Sales Representative',
  sales_executive: 'Sales Representative',
  senior_sales_executive: 'Senior Sales Executive',
  org_manager: 'Manager',
  manager: 'Manager',
  org_sr_manager: 'Senior Manager',
  org_admin: 'Org Admin',
  admin: 'Admin',
  tenant_admin: 'Tenant Admin',
  super_admin: 'Super Admin',
};

/**
 * True for any role in the individual-contributor "sales" tier.
 */
export function isSalesRole(role: (typeof ROLES)[number]): boolean {
  return (
    role === 'sales_rep' ||
    role === 'sales_executive' ||
    role === 'senior_sales_executive'
  );
}

// ── JWT / session ───────────────────────────────────────────────────────────
/** Token lifetime, as a `jsonwebtoken` expiresIn string. */
export const JWT_EXPIRES_IN = '7d';
/** Same lifetime in seconds — used for cookie Max-Age and manual checks. */
export const JWT_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
/** Token issuer/audience claims — pin these to detect cross-system token reuse. */
export const JWT_ISSUER = 'fitclass-crm';
export const JWT_AUDIENCE = 'fitclass-crm:web';

/** Name of the HTTP-only cookie that carries the session token. */
export const AUTH_COOKIE_NAME = 'fc_session';

// ── Routes ──────────────────────────────────────────────────────────────────
export const AUTH_ROUTES = {
  /** Public sign-in page. */
  login: '/login',
  /** Authenticated landing area (all sub-paths protected). */
  dashboard: '/dashboard',
  /** Where to send users after logout. */
  afterLogout: '/login',
  /** Where to send users after successful login. */
  afterLogin: '/dashboard/leads',
} as const;

/** Path prefixes that require a valid session (pages + APIs). */
export const PROTECTED_PREFIXES = ['/dashboard', '/api'] as const;

/**
 * EXACT paths that require a valid session — used for routes that cannot be
 * expressed as a prefix without accidentally swallowing every other route.
 *
 * `/` belongs here: it is a session-aware redirect (server-only), but the
 * middleware enforces auth at the Edge so an unauthenticated client never
 * reaches the page at all. This is the second layer of defence behind
 * `app/page.tsx` itself — if anything ever causes that page redirect to
 * fail in production (stale build, transient session-lookup error), the
 * Edge gate still bounces the request to /login. There is no production
 * scenario in which the root URL serves CRM content publicly.
 */
export const PROTECTED_EXACT_PATHS = ['/'] as const;

/**
 * Paths that must stay publicly reachable even when unauthenticated.
 * `/api/auth/*` covers the login / logout / me endpoints so the middleware
 * never deadlocks the sign-in flow.
 */
export const PUBLIC_PATHS = ['/login', '/api/auth'] as const;
