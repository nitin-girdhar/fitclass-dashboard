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
 *  - read_only              → view dashboard only
 *  - sales_representative   → individual contributor
 *  - senior_sales_executive → higher-rank IC; may absorb leads from juniors
 *  - org_manager            → owns a branch; routes work to sales tier
 *  - org_sr_manager         → senior manager tier
 *  - org_admin              → full access within one org
 *  - tenant_admin           → cross-org tenant dashboard
 *  - super_admin            → platform-wide administration
 */
export const ROLES = [
  "read_only",
  "sales_representative",
  "senior_sales_executive",
  "org_manager",
  "org_sr_manager",
  "org_admin",
  "tenant_admin",
  "super_admin",
] as const;

/**
 * Client-side role → rank lookup.
 *
 * Used ONLY to translate a role NAME string into a rank number where the
 * full SessionUser (with user.rank from the JWT) is not available — e.g.
 * filtering role dropdown options in RoleSelector.
 *
 * Server-side permission checks must use `actor.rank` (from the JWT, sourced
 * from user_roles.rank in PostgreSQL) — NOT this constant. Rank changes in the
 * DB take effect at next login; no code changes needed.
 *
 * MIRRORS user_roles.rank — keep in sync when adding roles to the DB migration.
 */
export const ROLE_RANK: Record<(typeof ROLES)[number], number> = {
  read_only: 0,
  sales_representative: 20,
  senior_sales_executive: 40,
  org_manager: 60,
  org_sr_manager: 70,
  org_admin: 80,
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
  read_only: "Read Only",
  sales_representative: "Sales Representative",
  senior_sales_executive: "Senior Sales Executive",
  org_manager: "Manager",
  org_sr_manager: "Senior Manager",
  org_admin: "Org Admin",
  tenant_admin: "Tenant Admin",
  super_admin: "Super Admin",
};

/**
 * Role tier groupings — single source of truth used by navigation.ts,
 * permission checks, and any future UI that needs tier-based filtering.
 * navigation.ts imports from here instead of defining its own local arrays.
 */
export const ROLE_TIERS = {
  ADMIN: ["super_admin", "tenant_admin", "org_admin"] as const,
  MANAGER: ["org_manager", "org_sr_manager"] as const,
  SSE: ["senior_sales_executive"] as const,
  SE: ["sales_representative"] as const,
  READ_ONLY: ["read_only"] as const,
} as const satisfies Record<string, ReadonlyArray<(typeof ROLES)[number]>>;

/**
 * True for any role in the individual-contributor "sales" tier.
 */
export function isSalesRole(role: (typeof ROLES)[number]): boolean {
  return (
    role === "sales_representative" ||
    role === "senior_sales_executive"
  );
}

// ── JWT / session ───────────────────────────────────────────────────────────
/** Token lifetime, as a `jsonwebtoken` expiresIn string. */
export const JWT_EXPIRES_IN = "7d";
/** Same lifetime in seconds — used for cookie Max-Age and manual checks. */
export const JWT_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
/** Token issuer/audience claims — pin these to detect cross-system token reuse. */
export const JWT_ISSUER = "fitclass-crm";
export const JWT_AUDIENCE = "fitclass-crm:web";

/** Name of the HTTP-only cookie that carries the session token. */
export const AUTH_COOKIE_NAME = "fc_session";

// ── Routes ──────────────────────────────────────────────────────────────────
export const AUTH_ROUTES = {
  /** Public sign-in page. */
  login: "/login",
  /** Authenticated landing area (all sub-paths protected). */
  dashboard: "/dashboard",
  /** Where to send users after logout. */
  afterLogout: "/login",
  /** Where to send users after successful login. */
  afterLogin: "/dashboard/leads",
} as const;

/** Path prefixes that require a valid session (pages + APIs). */
export const PROTECTED_PREFIXES = ["/dashboard", "/api"] as const;

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
export const PROTECTED_EXACT_PATHS = ["/"] as const;

/**
 * Paths that must stay publicly reachable even when unauthenticated.
 * `/api/auth/*` covers the login / logout / me endpoints so the middleware
 * never deadlocks the sign-in flow.
 */
export const PUBLIC_PATHS = ["/login", "/api/auth"] as const;
