# FitClass CRM — Architecture & Component Reference

## System Overview

FitClass CRM is a **Next.js 16 App Router** multi-tenant lead management system. The primary data store is a self-hosted **PostgreSQL 15+** database accessed directly via the `postgres` npm package (v3) — no ORM. A legacy **Supabase** path is preserved for teams that have not yet migrated.

The operating mode is selected at startup via two env vars:

| Variable | `local` | `supabase` |
|---|---|---|
| `AUTH_PROVIDER` | JWT issued by this app; user validated against PostgreSQL | JWT issued by Supabase Auth |
| `DB_PROVIDER` | Self-hosted PostgreSQL connection strings | Supabase-hosted PostgreSQL connection strings |

Both modes share the same session cookie, the same Edge middleware, and the same route handler files.

---

## High-Level Request Flow

```
Browser
  │
  ▼
middleware.ts  (Edge runtime)
  │  Reads cookie fc_session
  │  jose (WebCrypto) verifies JWT signature + expiry — no DB
  │  Unauth page request → redirect /login?callbackUrl=...
  │  Unauth API request  → JSON 401
  ▼
Next.js App Router  (Node runtime)
  │
  ├── /dashboard/*    Server Components + Client Components
  │
  └── /api/*          Route Handlers
         │
         ├── requireSession()       re-read user row from DB; check active + pwd_iat
         ├── Permission gate        pure RBAC functions, no I/O
         │
         └── Query helpers
               │
               ├── withOrgTx(orgId, userId, fn)       app_user pool
               ├── withTenantTx(tenantId, userId, fn) tenant_admin pool
               └── withServiceTx(fn)                  service_role pool (BYPASSRLS)
```

---

## Database Layer

### Three Connection Pools (`src/lib/db/client.ts`)

Each pool uses a different PostgreSQL login role and is constructed once per Node process via a module-level singleton.

| Helper | Login role | Group role activated | Purpose |
|---|---|---|---|
| `getAppPool()` | `lead_svc` (default) | `app_user` | All CRM operations; RLS enforced |
| `getTenantPool()` | `tenant_dash_svc` | `tenant_admin` | Cross-org tenant dashboard |
| `getServicePool()` | `service_role` | — (BYPASSRLS) | Migrations, auth queries, seed |

> `service_role` bypasses Row Level Security entirely. It is never called from any route that is reachable without a valid session.

### Transaction Helpers (`src/lib/db/transaction.ts`)

Every database operation that touches app data runs inside one of three helpers:

```typescript
withOrgTx<T>(orgId: string, userId: string, fn: (tx) => Promise<T>): Promise<T>
withTenantTx<T>(tenantId: string, userId: string, fn: (tx) => Promise<T>): Promise<T>
withServiceTx<T>(fn: (tx) => Promise<T>): Promise<T>
```

Each helper opens a transaction and sets the required GUCs before calling `fn`:

```sql
-- withOrgTx
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.current_org_id  = '<orgId>';
SET LOCAL app.current_user_id = '<userId>';
-- fn(tx) runs here
COMMIT;

-- withTenantTx
BEGIN;
SET LOCAL ROLE tenant_admin;
SET LOCAL app.current_tenant_id = '<tenantId>';
SET LOCAL app.current_user_id   = '<userId>';
COMMIT;
```

`SET LOCAL` (not `SET`) is required for **PgBouncer transaction-mode** pooling — the GUC state is automatically reset after every `COMMIT`, so there is no leakage between requests sharing a pooled connection.

### Row-Level Security

RLS policies are defined in `databse-model/03_rls_policies.sql`. They fire on `current_user` = `app_user` (or `tenant_admin`) and read the GUCs set by the transaction helpers:

- `app.current_org_id` — all CRM tables; confines reads/writes to one org
- `app.current_tenant_id` — tenant-admin tables; confines to one tenant's orgs
- `app.current_user_id` — used by audit triggers to stamp `created_by` / `updated_by`

Policies never fire for `service_role` (BYPASSRLS).

### Query Modules (`src/lib/db/queries/`)

| Module | Operations |
|---|---|
| `auth.ts` | `findUserByEmail`, `findUserById`, `stampLastLogin`, `updatePasswordHash` |
| `leads.ts` | `getLeads`, `getLeadById`, `createLead`, `updateLead`, `deleteLead` |
| `campaigns.ts` | `getCampaigns`, `getCampaignById`, `createCampaign`, `updateCampaign`, `deleteCampaign` |
| `followups.ts` | `getFollowUps`, `getFollowUpsByLead`, `createFollowUp`, `createFollowUpInTx`, `updateFollowUp`, `deleteFollowUp`, `completeFollowUp`, `rescheduleFollowUp`, `getFollowUpPipelineEnriched`, `markOverdueFollowUpsAsMissed` |
| `status-log.ts` | `getLeadTimeline`, `getLeadStatusLog`, `getStatusesRequiringFollowup`, `bustRequiresFollowupCache` |
| `interactions.ts` | `getInteractionsByLead`, `createInteraction` |
| `assignments.ts` | `getAssignmentTimeline`, `getAssignmentLog` |
| `users.ts` | `getUsers`, `getUserById`, `createUser`, `updateUser`, `deleteUser`, `getTeamMembers` |
| `lookups.ts` | `resolveLookupId` — converts string names to FK IDs via a module-level cache Map |

`resolveLookupId` accepts only table names in an allowlisted `LOOKUP_TABLES` Set, then uses `tx.unsafe()` to build the parameterised query dynamically. The result is cached in a module-level Map to avoid repeated DB round-trips for the same lookup.

`status-log.ts` holds a module-level `_requiresFollowupCache: Set<string> | null` that caches the set of status names with `requires_followup = true`. `bustRequiresFollowupCache()` clears it and is called by the admin route whenever the flag is toggled.

---

## Database Schema

Migration files live in `databse-model/`. They must be applied in numeric order (each depends on the previous). App-level migrations live in `src/lib/db/migrations/` and are applied via `npx tsx src/lib/db/migrations/apply.ts`.

### Core Tables

| Table | Key Points |
|---|---|
| `tenants` | Top-level tenant (gym chain, retail brand) |
| `organizations` | Physical location / branch within a tenant |
| `users` | `full_name` is `GENERATED ALWAYS AS STORED` (first_name \|\| last_name) — never insert directly; `password_changed_at` drives the JWT watermark |
| `user_roles` | Lookup table; roles resolved by name, IDs never hardcoded |
| `lead_statuses` | Lookup: status names + `requires_followup BOOLEAN` (added by `002_followup_system.sql`). Statuses with `requires_followup = true`: `contacted`, `qualified`, `on_hold`, `nurturing` |
| `marketing_leads` | Soft-delete via trigger (`DELETE` → `UPDATE SET is_deleted = TRUE`); `campaign_id` optional FK to `ad_campaigns` |
| `lead_status_log` | Immutable record of every status transition (added by `002_followup_system.sql`). Written by a `SECURITY DEFINER` trigger — `app_user` has no INSERT privilege on this table; the trigger writes on their behalf. RLS-protected: `org_isolation_policy` for `app_user`, `tenant_isolation_policy` for `tenant_admin` |
| `ad_campaigns` | Linked to leads and `marketing_platforms`; `started_at`/`ended_at` track campaign window |
| `lead_follow_ups` | `completed_at` required when `status = 'completed'` (enforced by trigger) |
| `lead_interactions` | Immutable call/chat log; no UPDATE path |
| `lead_assignment_log` | Append-only audit trail of every assignment change |

### Audit & History

- `marketing_leads_history` — every INSERT/UPDATE on `marketing_leads` is mirrored here by a trigger (`05_audit_triggers.sql`)
- Soft-delete trigger — intercepts `DELETE` on `marketing_leads` and turns it into an UPDATE; the row stays in the table with `is_deleted = TRUE` and the deleting user recorded in `deleted_by`
- `lead_status_log` trigger — `trg_lead_status_log` fires AFTER INSERT OR UPDATE OF `status_id`, `fail_reason_id` on `marketing_leads`; the `SECURITY DEFINER` function `log_lead_status_change()` reads `app.current_user_id` and `app.lead_transition_note` from the session GUCs to build the log entry

### Views

| View | Used by |
|---|---|
| `vw_dashboard_leads` | `/api/leads` GET list |
| `vw_sales_follow_up_pipeline` | Legacy pipeline (superseded by enriched view) |
| `vw_lead_assignment_timeline` | `/api/leads/[id]/assignment-history` |
| `vw_user_org_chart` | `/api/users/team` hierarchy |
| `vw_lead_followup_timeline` | `/api/leads/[id]/timeline` — UNION ALL of `lead_status_log` events and `lead_follow_ups` events, ordered by `event_at` |
| `vw_followup_pipeline_enriched` | `/api/follow-ups` GET — pending/missed follow-ups with lead status, `is_overdue`, `minutes_overdue`, last interaction type/time (via LATERAL join) |

### Lookup Tables

The following small tables are populated by `01_lookup_tables.sql` and referenced by FK everywhere:

`lead_statuses`, `user_roles`, `marketing_platforms`, `campaign_statuses`, `interaction_types`, `follow_up_statuses`

---

## Follow-Up System

Added by `src/lib/db/migrations/002_followup_system.sql`.

### Status Transition Logging

Every write to `marketing_leads.status_id` or `fail_reason_id` automatically inserts a row into `lead_status_log`. The mechanism is a `SECURITY DEFINER` trigger function `log_lead_status_change()` that:

1. Reads `app.current_user_id` from the session GUC (set by `withOrgTx`)
2. Reads `app.lead_transition_note` from the session GUC (set by the status-change route immediately before the UPDATE)
3. Inserts into `lead_status_log` with the old/new status IDs, user ID, org ID, and note

`app_user` has no INSERT privilege on `lead_status_log`. The `SECURITY DEFINER` function runs as the owning role (which has the privilege). This is the standard PostgreSQL pattern for letting unprivileged code write to an append-only audit table safely.

### GUC-Passed Transition Note

The status-change route sets the transition note via `SET LOCAL` before the UPDATE:

```sql
SET LOCAL app.lead_transition_note = 'Discussed pricing, call back Thursday';
UPDATE marketing_leads SET status_id = $1 WHERE id = $2;
SET LOCAL app.lead_transition_note = '';   -- clear immediately after trigger fires
```

`SET LOCAL` is used (not `SET`) so the GUC is reset at transaction commit — no leakage across pooled connections.

### Atomic Status Change + Follow-Up

When a status with `requires_followup = true` is selected, the follow-up must be created in the **same transaction** as the status change. The route handler uses this pattern:

```
withOrgTx(orgId, userId, async (tx) => {
  // 1. Verify lead belongs to org, not deleted
  // 2. Resolve new status ID
  // 3. Validate transition (no-op if same status)
  // 4. SET LOCAL app.lead_transition_note = note
  // 5. UPDATE marketing_leads SET status_id = ...   ← trigger fires, writes status_log
  // 6. SET LOCAL app.lead_transition_note = ''
  // 7. createFollowUpInTx(tx)                       ← same transaction
})
```

`createFollowUpInTx` accepts an external `tx` parameter instead of calling `withOrgTx` internally — this is the only way to compose two writes into a single atomic transaction.

### Overdue Mark Cron

`GET /api/cron/mark-missed-followups` is called every 15 minutes by Vercel Cron (configured in `vercel.json`). It calls `markOverdueFollowUpsAsMissed()` via `withServiceTx` (BYPASSRLS so it runs across all orgs) and returns the count of rows updated. The endpoint validates the `x-cron-secret` request header against `process.env.CRON_SECRET`.

### UI Components

| Component | Location | Purpose |
|---|---|---|
| `StatusChangeTrigger` | `components/leads/` | Dropdown that opens a modal for `requires_followup` statuses and `failed` |
| `FollowUpScheduleModal` | `components/leads/` | Collect follow-up details or fail reason; exports `FollowUpDetails` interface |
| `LeadTimeline` | `components/leads/` | Renders `vw_lead_followup_timeline` events; opens `FollowUpActionModal` for actionable rows |
| `FollowUpActionModal` | `components/leads/` | Complete / reschedule / add note for a pending or missed follow-up |
| `FollowUpPipeline` | `components/leads/` | Table of `FollowUpEnriched` rows with overdue badge; used on `/dashboard/follow-ups` |

`FollowUpDetails` interface (exported from `FollowUpScheduleModal.tsx`):

```typescript
interface FollowUpDetails {
  transitionNote?: string;
  failReasonId?: number;
  /** Absent when the new status does not require a follow-up (e.g. 'failed'). */
  followUp?: { assignedUserId: string; scheduledAt: string; notes?: string };
}
```

### `requires_followup` Cache

`getStatusesRequiringFollowup()` in `status-log.ts` returns a `Set<string>` of status names. The result is stored in a module-level `_requiresFollowupCache` variable. When an `org_admin` toggles the flag via `PATCH /api/admin/lead-statuses/[id]`, the route calls `bustRequiresFollowupCache()` to clear the cache so the next call re-fetches from the DB.

---

## Auth System

### Edge Layer — `middleware.ts`

Runs on the Vercel/Cloudflare Edge runtime before any Node code. Uses `jose` (WebCrypto) to verify the `fc_session` JWT. Does **not** touch the database.

- Protected patterns: `/dashboard/*`, `/api/*`
- Public patterns: `/login`, `/api/auth/login`
- Invalid token on a page request → 302 to `/login?callbackUrl=<encoded>`
- Invalid token on an API request → JSON `{ error: "Unauthorized" }` 401
- Valid token → request passes through to the route handler

### Node Layer — `src/lib/auth/session.ts`

Called inside every API handler via `requireSession()`. Performs three checks the Edge cannot:

1. Re-reads the user row from PostgreSQL via `findUserById` (catches deactivation and role changes since the token was issued)
2. Checks `is_active === true`
3. Compares `pwd_iat` (epoch seconds embedded in the JWT at sign time) against the DB's current `password_changed_at` — if the DB value is newer, the token is rejected. This is the **password rotation revocation mechanism**: changing a password instantly invalidates all prior tokens without a server-side session store.

### JWT

- Cookie name: `fc_session` (HTTP-only, SameSite=Lax)
- Payload: `{ sub, email, role, orgId, pwd_iat, iat, exp }`
- Signed with `JWT_SECRET` using HMAC-SHA256
- Edge uses `jose` (WebCrypto); Node uses `jsonwebtoken`
- Expiry: 7 days; no refresh token (user logs in again after expiry)

### Login Flow (`/api/auth/login`)

```
POST /api/auth/login { email, password }
  → findUserByEmail (service_role — no org context yet)
  → bcrypt.compare (constant-time, BCRYPT_ROUNDS work factor)
  → check is_active
  → stampLastLogin
  → signJwt({ sub, email, role, orgId, pwd_iat })
  → Set-Cookie: fc_session=<token>; HttpOnly; SameSite=Lax
```

A single generic error message (`"Invalid credentials"`) is returned for all failure modes (user not found, wrong password, inactive) to prevent account enumeration.

---

## RBAC — Permission System

### User Roles

Defined in `databse-model/01_lookup_tables.sql` and seeded into the `user_roles` table. The hierarchy is purely by convention — no numeric rank is stored in the DB.

| Role | Scope |
|---|---|
| `read_only` | Dashboard view, no mutations |
| `sales_rep` | Own leads only |
| `sales_executive` | Own leads (legacy Supabase alias) |
| `senior_sales_executive` | Team leads; can assign to sales tier |
| `org_manager` / `manager` | Branch-level; `manager` is the legacy Supabase alias |
| `org_admin` / `admin` | Full access within one org; can toggle `requires_followup` on statuses; `admin` is the legacy alias |
| `tenant_admin` | Cross-org dashboard for a tenant |
| `super_admin` | Platform-wide |

`isSalesRole(role)` in `src/features/auth/constants.ts` returns `true` for `sales_rep`, `sales_executive`, and `senior_sales_executive`. It is used to restrict follow-up pipeline access to a user's own records.

### Permission Helpers (`src/lib/permissions/`)

Pure, synchronous functions with no I/O. Safe to call inside a `.filter()` over large arrays.

| Function | File | What it checks |
|---|---|---|
| `canViewLeadData(session, ctx)` | `leads.ts` | admin: all; manager/SSE: in-branch; sales_rep: only assigned |
| `canEditLead(session, ctx)` | `leads.ts` | Same matrix as view |
| `canAssignLead(session, ctx)` | `leads.ts` | admin: all; manager/SSE: in-branch; sales_rep: never |
| `canCreateUser(session, targetRole)` | `users.ts` | Can only create roles below own level |
| `canEditUser(session, target)` | `users.ts` | Cannot edit users at or above own role |

---

## API Layer

### Route Handler Pattern

Every route handler follows the same structure:

```typescript
export async function GET(req, { params }: { params: Promise<{ id: string }> }) {
  // 1. Provider guard
  if (AUTH_PROVIDER !== "local") return NextResponse.json({ error: "..." }, { status: 400 });

  // 2. Auth gate
  const gate = await requireSession();
  if (!gate.ok) return gate.response;   // 401 or 403

  // 3. Params (Next.js 16: params is a Promise)
  const { id } = await params;

  // 4. Input validation (Zod v4)
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "...", details: parsed.error.issues }, { status: 400 });

  // 5. Query (inside withOrgTx / withTenantTx / withServiceTx)
  const result = await someQuery(gate.session.orgId, gate.session.id, parsed.data);

  // 6. Response
  return NextResponse.json(result, { status: 200 });
}
```

### Key Routes

| Routes | Pool used | Notes |
|---|---|---|
| `/api/auth/*` | `service_role` | No org context at login time |
| `/api/leads/*` | `app_user` | RLS scopes to `current_org_id` |
| `/api/leads/[id]/status` | `app_user` | Atomic status change + optional follow-up in one `withOrgTx`; validates `newStatus`, optional `failReasonId`, optional `followUp` |
| `/api/leads/[id]/timeline` | `app_user` | Reads `vw_lead_followup_timeline`; returns status-change and follow-up events merged |
| `/api/campaigns/*` | `app_user` | Campaign date fields: `startDate`/`endDate` map to `started_at`/`ended_at` in DB |
| `/api/follow-ups` | `app_user` | Enriched pipeline via `vw_followup_pipeline_enriched`; IC sales roles restricted to own records |
| `/api/leads/[id]/follow-ups/[followUpId]` | `app_user` | `PATCH` uses discriminated union `{ action: "complete" \| "reschedule" \| "add_note" }` |
| `/api/lookups/lead-statuses` | `app_user` | Returns statuses with `requires_followup` flag |
| `/api/admin/lead-statuses/[id]` | `app_user` | `org_admin`+ only; toggles `requires_followup`; calls `bustRequiresFollowupCache()` |
| `/api/cron/mark-missed-followups` | `service_role` | `x-cron-secret` header auth; marks overdue follow-ups as missed across all orgs |
| `/api/users/*` | `app_user` | RBAC checks on role comparisons before write |
| `/api/intake/webhook` | `app_user` | API key auth (not JWT); `intake_svc` login role |
| `/api/dashboard/*` | `tenant_admin` | `tenant_admin` role required |
| `/api/org/performance` | `app_user` | `org_admin` or above |

---

## Data Flows

### View Leads

```
GET /api/leads?page=1&status=new
  → middleware: verify JWT signature (Edge, no DB)
  → requireSession(): re-read user row, check active + pwd_iat (Node, service_role)
  → withOrgTx(orgId, userId):
        SET LOCAL ROLE app_user;
        SET LOCAL app.current_org_id = '<orgId>';
        SELECT * FROM vw_dashboard_leads WHERE ... (RLS fires)
  → JSON { leads, total, page }
```

### Create Lead

```
POST /api/leads { firstName, lastName, phone, statusName, campaignId, ... }
  → Zod parse
  → resolveLookupId("lead_statuses", statusName) → cached FK lookup
  → withOrgTx:
        INSERT INTO marketing_leads (...) RETURNING id
        → audit trigger fires → INSERT INTO marketing_leads_history
  → JSON { id } 201
```

### Atomic Status Change + Follow-Up

```
PATCH /api/leads/[id]/status { newStatus: "qualified", followUp: { assignedUserId, scheduledAt } }
  → requireSession()
  → withOrgTx(orgId, userId, async (tx) => {
        SELECT id FROM marketing_leads WHERE id = $1 AND org_id = $2 AND NOT is_deleted  ← verify ownership
        SELECT id, requires_followup FROM lead_statuses WHERE name = $1                  ← resolve status
        SET LOCAL app.lead_transition_note = 'optional note'
        UPDATE marketing_leads SET status_id = $1 WHERE id = $2                          ← trigger fires
        SET LOCAL app.lead_transition_note = ''
        INSERT INTO lead_follow_ups (...) RETURNING id                                   ← same tx
    })
  → JSON { success: true } 200

Trigger path (inside the UPDATE above):
  trg_lead_status_log → log_lead_status_change() [SECURITY DEFINER]
    → reads app.current_user_id and app.lead_transition_note
    → INSERT INTO lead_status_log (org_id, lead_id, old_status_id, new_status_id, changed_by, note)
```

### Assign Lead

```
PATCH /api/leads/[id]/assignments { assignedToUserId }
  → canAssignLead(session, { orgId, assignedToUserId })
  → withOrgTx:
        UPDATE marketing_leads SET assigned_to = $1 WHERE id = $2
        INSERT INTO lead_assignment_log (lead_id, new_assigned_user_id, assigned_by, ...)
```

### Password Change

```
POST /api/auth/change-password { currentPassword, newPassword }
  → requireSession()
  → bcrypt.compare(currentPassword, user.passwordHash)
  → bcrypt.hash(newPassword, BCRYPT_ROUNDS)
  → withServiceTx:
        UPDATE users SET password_hash = $1, password_changed_at = CLOCK_TIMESTAMP()
        RETURNING EXTRACT(EPOCH FROM password_changed_at)::bigint AS pwd_epoch
  → signJwt({ ..., pwd_iat: pwd_epoch })   ← new token with updated watermark
  → Set-Cookie: fc_session=<new_token>
```

---

## Directory Structure

```
fitclass_dashboard_with_db/
├── app/
│   ├── api/                   Route handlers
│   │   ├── auth/              login, logout, change-password
│   │   ├── leads/             CRUD + nested status, timeline, follow-ups, interactions, assignments
│   │   │   └── [id]/
│   │   │       ├── status/    PATCH — atomic status change + optional follow-up
│   │   │       ├── timeline/  GET  — merged status-change + follow-up timeline
│   │   │       └── follow-ups/[followUpId]/  PATCH — complete/reschedule/add_note
│   │   ├── campaigns/         CRUD
│   │   ├── follow-ups/        Org-wide enriched pipeline
│   │   ├── users/             CRUD + team hierarchy
│   │   ├── dashboard/         Tenant-level summary
│   │   ├── intake/            Webhook receiver
│   │   ├── org/               Org performance
│   │   ├── lookups/
│   │   │   └── lead-statuses/ GET — statuses with requires_followup flag
│   │   ├── admin/
│   │   │   └── lead-statuses/[id]/  PATCH — toggle requires_followup (org_admin+)
│   │   └── cron/
│   │       └── mark-missed-followups/  GET — mark overdue follow-ups as missed
│   ├── dashboard/
│   │   ├── follow-ups/        Follow-up pipeline page (overdue + all)
│   │   └── ...
│   └── login/                 Login page
│
├── src/
│   ├── lib/
│   │   ├── auth/
│   │   │   ├── session.ts     requireSession() — Node JWT + DB revalidation
│   │   │   └── jwt.ts         signJwt, verifyJwt (Node)
│   │   ├── db/
│   │   │   ├── client.ts      Three pool singletons (camelcase transform)
│   │   │   ├── transaction.ts withOrgTx, withTenantTx, withServiceTx
│   │   │   ├── migrations/    apply.ts migration runner + SQL files
│   │   │   └── queries/       One module per domain (leads, followups, status-log, ...)
│   │   ├── permissions/       Pure RBAC gate functions
│   │   └── errors.ts          AppError (message + statusCode)
│   ├── features/
│   │   ├── auth/
│   │   │   └── constants.ts   isSalesRole(), role rank helpers
│   │   └── users/
│   │       └── serializers.ts toSessionUser (DB row → JWT payload shape)
│   └── types/
│       ├── auth.ts            SessionUser, UserRole
│       └── db.ts              DB row types (User, Lead, Campaign, LeadStatus,
│                              LeadStatusLogEntry, FollowUpEnriched, TimelineEvent, ...)
│
├── components/
│   ├── leads/
│   │   ├── StatusChangeTrigger.tsx     Status dropdown → modal for requires_followup / failed
│   │   ├── FollowUpScheduleModal.tsx   Collect assignee + scheduled time (+ fail reason)
│   │   ├── LeadTimeline.tsx            Renders vw_lead_followup_timeline events
│   │   ├── FollowUpActionModal.tsx     Complete / reschedule / add note for a follow-up
│   │   └── FollowUpPipeline.tsx        Org-wide pipeline table with overdue badge
│   └── ...
│
├── databse-model/             SQL migration files 00–10 (core schema)
├── src/lib/db/migrations/     App-level migrations (001, 002, ...)
├── supabase/migrations/       Legacy Supabase migration files
├── vercel.json                Vercel Cron schedule (*/15 * * * * → mark-missed-followups)
├── middleware.ts              Edge JWT verification
├── .env.local.example         All env vars with comments
├── README.md                  Architecture overview + quick-start
├── SETUP.md                   Step-by-step setup for both paths
└── ARCHITECTURE.md            This file
```

---

## Key Design Decisions

| Decision | Reason |
|---|---|
| `postgres` npm package, no ORM | Tagged template literals produce safe parameterised queries; `camelcase` transform eliminates `snake_case` mapping boilerplate; no schema file to keep in sync |
| Three pools, not one | Separates privilege surfaces: `app_user` (RLS on) vs `service_role` (BYPASSRLS). Limits blast radius if a connection string leaks |
| `SET LOCAL` GUCs in transactions | Passes request context (org, user, tenant) to RLS policies and audit triggers without application-level re-implementation of the same checks. `SET LOCAL` resets on `COMMIT`, which is required for PgBouncer transaction mode |
| `app.lead_transition_note` GUC | The status-change trigger needs the transition note but `app_user` cannot write to `lead_status_log` directly. Passing the note via `SET LOCAL` GUC (read by the `SECURITY DEFINER` function) avoids an extra privilege grant while keeping the data in the same transaction |
| `SECURITY DEFINER` trigger for `lead_status_log` | `app_user` is granted no INSERT on `lead_status_log` — the table is append-only and must not be writable by application code. The trigger function runs as its owning role (which has INSERT) and acts as the sole write path, enforcing immutability |
| `createFollowUpInTx(tx)` separate from `createFollowUp` | `createFollowUp` calls `withOrgTx` internally and cannot be composed into an outer transaction. `createFollowUpInTx` accepts an external `tx` to enable the atomic status-change + follow-up pattern |
| Atomic status change + follow-up | If the follow-up insert fails, the status change is rolled back. The user always gets consistent state — a lead is never moved to a `requires_followup` status without a scheduled follow-up |
| Discriminated union PATCH schema for follow-up actions | A single `updateFollowUp` function with optional fields silently ignores the `action` field. Routing on `action: "complete" \| "reschedule" \| "add_note"` makes the intent explicit and prevents partial updates from silently succeeding |
| `pwd_iat` watermark in JWT | Password reset invalidates all prior sessions for a user without a server-side session store or revocation list; the invalidation takes effect on the next DB call |
| Dual-provider switch | Allows Supabase-hosted teams to migrate to self-hosted PostgreSQL without a flag day; the app runs both modes from the same codebase |
| `GENERATED ALWAYS AS STORED` for `full_name` | DB enforces the derived column; application code can never accidentally insert stale or inconsistent name data |
| Soft-delete via trigger | `DELETE` privilege on `marketing_leads` is granted to `app_user`, but the trigger silently converts it to a soft-delete UPDATE. The application never needs a special "soft-delete path" — it just calls DELETE |
| `resolveLookupId` allowlist + cache | Lookup table name is a runtime string, so SQL must be built dynamically. The `LOOKUP_TABLES` Set prevents SQL injection via table-name substitution; the module-level Map prevents repeated round-trips for stable reference data |
| Next.js 16 async params | `params` in dynamic route handlers is a `Promise<{...}>` in Next.js 16; it must be awaited. All route handlers follow `const { id } = await params` |
| Zod v4 `z.record` signature | Zod v4 requires two type arguments: `z.record(z.string(), z.unknown())`. The single-argument form from Zod v3 is a type error in v4 |
