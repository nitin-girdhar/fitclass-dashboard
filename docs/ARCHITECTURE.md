# FitClass CRM — Architecture & Component Reference

## System Overview

FitClass CRM is a **Next.js 16 App Router** multi-tenant lead management system. The data store is a **PostgreSQL 15+** database accessed directly via the `postgres` npm package (v3) — no ORM, no Supabase JS client. Any PostgreSQL host works: local Docker, self-hosted, or Supabase used purely as a managed PostgreSQL instance via connection strings.

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
  └── /api/*          Route Handlers (wrapped with withRoute HOF)
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

| Helper             | Login role           | Group role activated | Purpose                          |
| ------------------ | -------------------- | -------------------- | -------------------------------- |
| `getAppPool()`     | `lead_svc` (default) | `app_user`           | All CRM operations; RLS enforced |
| `getTenantPool()`  | `tenant_dash_svc`    | `tenant_admin`       | Cross-org tenant dashboard       |
| `getServicePool()` | `service_role`       | — (BYPASSRLS)        | Migrations, auth queries, seed   |

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

RLS policies are defined in `databse-model/04_rls_policies.sql`. They fire on `current_user` = `app_user` (or `tenant_admin`) and read the GUCs set by the transaction helpers:

- `app.current_org_id` — all CRM tables; confines reads/writes to one org
- `app.current_tenant_id` — tenant-admin tables; confines to one tenant's orgs
- `app.current_user_id` — used by audit triggers to stamp `created_by` / `updated_by`

Policies never fire for `service_role` (BYPASSRLS).

### Query Modules (`src/lib/db/queries/`)

| Module            | Operations                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.ts`         | `findUserByEmail`, `findUserById`, `stampLastLogin`, `updatePasswordHash`                                                                                                                                                 |
| `leads.ts`        | `getLeads`, `getLeadById`, `createLead`, `updateLead`, `deleteLead`                                                                                                                                                       |
| `campaigns.ts`    | `getCampaigns`, `getCampaignById`, `createCampaign`, `updateCampaign`, `deleteCampaign`                                                                                                                                   |
| `followups.ts`    | `getFollowUps`, `getFollowUpsByLead`, `createFollowUp`, `createFollowUpInTx`, `updateFollowUp`, `deleteFollowUp`, `completeFollowUp`, `rescheduleFollowUp`, `getFollowUpPipelineEnriched`, `markOverdueFollowUpsAsMissed` |
| `status-log.ts`   | `getLeadTimeline`, `getLeadStatusLog`, `getStatusesRequiringFollowup`, `bustRequiresFollowupCache`                                                                                                                        |
| `interactions.ts` | `getInteractionsByLead`, `createInteraction`                                                                                                                                                                              |
| `assignments.ts`  | `getAssignmentTimeline`, `getAssignmentLog`                                                                                                                                                                               |
| `users.ts`        | `getUsers`, `getUserById`, `createUser`, `updateUser`, `deleteUser`, `getTeamMembers`                                                                                                                                     |
| `lookups.ts`      | `resolveLookupId` — converts string names to FK IDs via a module-level cache Map                                                                                                                                          |

`resolveLookupId` accepts only table names in an allowlisted `LOOKUP_TABLES` Set, then uses `tx.unsafe()` to build the parameterised query dynamically. The result is cached in a module-level Map to avoid repeated DB round-trips for the same lookup.

`status-log.ts` holds a module-level `_requiresFollowupCache: Set<string> | null` that caches the set of status names with `requires_followup = true`. `bustRequiresFollowupCache()` clears it and is called by the admin route whenever the flag is toggled.

---

## Database Schema

Schema files live in `databse-model/` and must be applied in numeric order. Each depends on the previous.

### Schema Files

| File | Contents |
| ---- | -------- |
| `00_extensions.sql` | `pg_trgm`, `btree_gin`, optional `pgvector` |
| `01_roles.sql` | Group roles: `app_user` (NOLOGIN), `tenant_admin` (NOLOGIN), `service_role` (BYPASSRLS LOGIN) |
| `02_lookup_tables.sql` | `lead_statuses`, `user_roles`, `marketing_platforms`, `campaign_statuses`, `interaction_types`, geography |
| `03_core_tables.sql` | `tenants`, `organizations`, `users`, `marketing_leads`, `lead_follow_ups`, `lead_interactions`, `ad_campaigns`, `lead_assignment_log` |
| `04_rls_policies.sql` | RLS policies on all tables; fire on `app.current_org_id` / `app.current_tenant_id` GUC |
| `05_indexes.sql` | GIN trigram indexes on leads, BTREE indexes on foreign keys |
| `06_audit_triggers.sql` | `marketing_leads_history` audit table; soft-delete trigger; `SECURITY DEFINER` status-log trigger |
| `07_views.sql` | `vw_dashboard_leads`, `vw_lead_followup_timeline`, `vw_followup_pipeline_enriched`, `vw_lead_assignment_timeline`, `vw_user_org_chart`, others |
| `08_grants.sql` | Table-level `GRANT`/`REVOKE` for all service roles |
| `09_seed_data.sql` | 2 tenants, 4 orgs, 12 users, 36 leads — **dev/staging only** |
| `10_user_hierarchy.sql` | `vw_user_org_chart` view, `can_assign_to()` function, manager adjacency list |
| `11_service_logins.sql` | 7 login roles: `lead_svc`, `campaign_svc`, `user_mgmt_svc`, `notif_svc`, `intake_svc`, `tenant_dash_svc`, `analytics_svc` |

### Core Tables

| Table                 | Key Points |
| --------------------- | ---------- |
| `tenants`             | Top-level tenant (gym chain, retail brand) |
| `organizations`       | Physical location / branch within a tenant |
| `users`               | `full_name` is `GENERATED ALWAYS AS STORED` (first_name \|\| middle_name \|\| last_name) — never insert directly; `password_changed_at` drives the JWT watermark |
| `user_roles`          | Lookup table; roles resolved by name, IDs never hardcoded; `rank` column drives RBAC |
| `lead_statuses`       | `requires_followup BOOLEAN` — statuses with this true trigger the follow-up modal |
| `marketing_leads`     | Soft-delete via trigger (`DELETE` → `UPDATE SET is_deleted = TRUE`); `assigned_user_id` FK to `users` |
| `lead_status_log`     | Immutable record of every status transition. Written by a `SECURITY DEFINER` trigger — `app_user` has no INSERT privilege; the trigger writes on their behalf |
| `ad_campaigns`        | Linked to leads and `marketing_platforms`; `started_at`/`ended_at` track campaign window |
| `lead_follow_ups`     | `completed_at` required when `status = 'completed'` (enforced by trigger) |
| `lead_interactions`   | Immutable call/chat log; no UPDATE path |
| `lead_assignment_log` | Append-only audit trail of every assignment change |

### Audit & History

- `marketing_leads_history` — every INSERT/UPDATE on `marketing_leads` is mirrored here by a trigger
- Soft-delete trigger — intercepts `DELETE` on `marketing_leads` and turns it into an UPDATE; the row stays in the table with `is_deleted = TRUE`
- `lead_status_log` trigger — `trg_lead_status_log` fires AFTER INSERT OR UPDATE OF `status_id` on `marketing_leads`; the `SECURITY DEFINER` function `log_lead_status_change()` reads `app.current_user_id` and `app.lead_transition_note` from session GUCs

### Views

| View | Used by |
| ---- | ------- |
| `vw_dashboard_leads` | `/api/leads` GET list |
| `vw_lead_assignment_timeline` | `/api/leads/[id]/assignment-history` |
| `vw_user_org_chart` | `/api/users/team` hierarchy |
| `vw_lead_followup_timeline` | `/api/leads/[id]/timeline` — UNION ALL of `lead_status_log` events and `lead_follow_ups` events |
| `vw_followup_pipeline_enriched` | `/api/follow-ups` GET — pending/missed follow-ups with `is_overdue`, `minutes_overdue`, last interaction (via LATERAL join) |

---

## Follow-Up System

### Status Transition Logging

Every write to `marketing_leads.status_id` automatically inserts a row into `lead_status_log`. The mechanism is a `SECURITY DEFINER` trigger function `log_lead_status_change()` that:

1. Reads `app.current_user_id` from the session GUC (set by `withOrgTx`)
2. Reads `app.lead_transition_note` from the session GUC (set by the status-change route immediately before the UPDATE)
3. Inserts into `lead_status_log` with the old/new status IDs, user ID, org ID, and note

`app_user` has no INSERT privilege on `lead_status_log`. The `SECURITY DEFINER` function runs as the owning role. This is the standard PostgreSQL pattern for letting unprivileged code write to an append-only audit table safely.

### GUC-Passed Transition Note

```sql
SET LOCAL app.lead_transition_note = 'Discussed pricing, call back Thursday';
UPDATE marketing_leads SET status_id = $1 WHERE id = $2;
SET LOCAL app.lead_transition_note = '';   -- clear immediately after trigger fires
```

### Atomic Status Change + Follow-Up

When a status with `requires_followup = true` is selected, the follow-up must be created in the **same transaction** as the status change:

```
withOrgTx(orgId, userId, async (tx) => {
  // 1. Verify lead belongs to org, not deleted
  // 2. Resolve new status ID
  // 3. SET LOCAL app.lead_transition_note = note
  // 4. UPDATE marketing_leads SET status_id = ...   ← trigger fires, writes status_log
  // 5. SET LOCAL app.lead_transition_note = ''
  // 6. createFollowUpInTx(tx)                       ← same transaction
})
```

`createFollowUpInTx` accepts an external `tx` parameter instead of calling `withOrgTx` internally — this is the only way to compose two writes into a single atomic transaction.

### Overdue Mark Cron

`GET /api/cron/mark-missed-followups` is called every 15 minutes by Vercel Cron (configured in `vercel.json`). It calls `markOverdueFollowUpsAsMissed()` via `withServiceTx` (BYPASSRLS so it runs across all orgs). The endpoint validates the `x-cron-secret` request header against `CRON_SECRET`.

---

## Auth System

### Edge Layer — `middleware.ts`

Runs on the Vercel/Cloudflare Edge runtime before any Node code. Uses `jose` (WebCrypto) to verify the `fc_session` JWT. Does **not** touch the database.

- Protected patterns: `/dashboard/*`, `/api/*`
- Public patterns: `/login`, `/api/auth/login`
- Invalid token on a page request → 302 to `/login?callbackUrl=<encoded>`
- Invalid token on an API request → JSON `{ error: "Unauthorized" }` 401

### Node Layer — `src/lib/auth/session.ts`

Called inside every API handler via `requireSession()`. Performs three checks the Edge cannot:

1. Re-reads the user row from PostgreSQL via `findUserById` (catches deactivation and role changes since the token was issued)
2. Checks `is_active === true`
3. Compares `pwd_iat` (epoch seconds embedded in the JWT at sign time) against the DB's current `password_changed_at` — if the DB value is newer, the token is rejected (password rotation revocation)

### JWT

- Cookie name: `fc_session` (HTTP-only, SameSite=Lax)
- Payload: `{ sub, email, role, rank, orgId, pwd_iat, iat, exp }`
- Signed with `JWT_SECRET` using HMAC-SHA256
- Edge uses `jose` (WebCrypto); Node uses `jsonwebtoken`
- Expiry: 7 days; no refresh token

### Login Flow

```
POST /api/auth/login { email, password }
  → findUserByEmail (service_role — no org context yet)
  → bcrypt.compare (constant-time, BCRYPT_ROUNDS work factor)
  → check is_active
  → stampLastLogin
  → signJwt({ sub, email, role, rank, orgId, pwd_iat })
  → Set-Cookie: fc_session=<token>; HttpOnly; SameSite=Lax
```

A single generic error message (`"Invalid credentials"`) is returned for all failure modes to prevent account enumeration.

---

## RBAC — Permission System

### User Roles

Defined in `databse-model/02_lookup_tables.sql` and seeded into the `user_roles` table. Rank is stored in `user_roles.rank` and embedded in the JWT at login — permission checks use `actor.rank` from the JWT, not a lookup table.

| Role                     | Rank | Scope |
| ------------------------ | ---- | ----- |
| `read_only`              | 0    | Dashboard view, no mutations |
| `sales_representative`   | 20   | Own leads only |
| `senior_sales_executive` | 40   | Team leads; can assign to sales tier |
| `org_manager`            | 60   | Branch-level; routes work to sales tier |
| `org_sr_manager`         | 70   | Senior manager tier |
| `org_admin`              | 80   | Full access within one org; can toggle `requires_followup` on statuses |
| `tenant_admin`           | 90   | Cross-org dashboard for a tenant |
| `super_admin`            | 100  | Platform-wide |

Legacy aliases retained for JWT backward-compatibility: `sales_executive` (20), `manager` (60), `admin` (80). Use `CANONICAL_ROLES` from `src/features/auth/constants.ts` for UI dropdowns to avoid showing duplicate labels.

### Org-Scope Resolution (`src/lib/permissions/scope.ts`)

```typescript
resolveActorOrgIds(actor: SessionUser): Promise<string[] | null>
// super_admin  → null  (no filter — sees all tenants)
// tenant_admin → all org IDs within their tenant
// everyone else → [actor.orgId]  (own org only)
```

Called server-side in page components and API routes before listing users, assignments, or leads.

### Permission Helpers (`src/lib/permissions/`)

Pure, synchronous functions with no I/O. Safe to call inside a `.filter()`.

| Function | File | What it checks |
| -------- | ---- | -------------- |
| `canViewLeadData(session, ctx)` | `leads.ts` | admin: all; manager/SSE: in-branch; SR: only assigned |
| `canEditLead(session, ctx)` | `leads.ts` | Same matrix as view |
| `canAssignLead(session, ctx)` | `leads.ts` | admin: all; manager/SSE: in-branch; SR: never |
| `canCreateUser(session, targetRole)` | `users.ts` | Can only create roles below own level |
| `canEditUser(session, target)` | `users.ts` | Cannot edit users at or above own role |
| `canViewUser(actor, target)` | `index.ts` | admin: all; manager/SSE: same-org non-admin only |
| `canAssignToUser(actorRank, targetRank, ...)` | `assignments.ts` | Numeric rank comparison |

---

## API Layer

### Route Handler Pattern — `withRoute` HOF

31 of 40 API routes use the `withRoute` higher-order function from `src/lib/api/route-handler.ts`. It handles:

1. `requireSession()` — returns 401 if the JWT is missing or invalid
2. `AppError` subclasses — maps to the error's `statusCode` (404, 403, 400, etc.)
3. Unhandled errors — logs with method + path, returns 500
4. Next.js 16 `params` as `Promise` — awaited internally

```typescript
// Dynamic-route usage:
export const GET = withRoute<{ id: string }>(async (req, session, { id }) => {
  const row = await getLeadById(session.orgId, id);
  if (!row) throw new NotFoundError('Lead not found');
  return NextResponse.json(row);
});

// Non-dynamic usage:
export const GET = withRoute(async (_req, session) => {
  const rows = await listUsers([session.orgId]);
  return NextResponse.json(rows);
});
```

Routes that use specialised auth (role-gated endpoints, public login, cron secret, webhook API key) do not use `withRoute` and handle auth explicitly.

### Key Routes

| Route | Pool | Notes |
| ----- | ---- | ----- |
| `/api/auth/*` | `service_role` | No org context at login time |
| `/api/leads/*` | `app_user` | RLS scopes to `current_org_id` |
| `/api/leads/[id]/status` | `app_user` | Atomic status change + optional follow-up in one `withOrgTx` |
| `/api/leads/[id]/timeline` | `app_user` | Reads `vw_lead_followup_timeline`; returns status-change and follow-up events merged |
| `/api/campaigns/*` | `app_user` | Campaign date fields: `startDate`/`endDate` map to `started_at`/`ended_at` in DB |
| `/api/follow-ups` | `app_user` | Enriched pipeline via `vw_followup_pipeline_enriched`; IC roles restricted to own records |
| `/api/leads/[id]/follow-ups/[followUpId]` | `app_user` | PATCH uses discriminated union `{ action: "complete" \| "reschedule" \| "add_note" }` |
| `/api/admin/lead-statuses/[id]` | `app_user` | `org_admin`+ only; toggles `requires_followup`; calls `bustRequiresFollowupCache()` |
| `/api/cron/mark-missed-followups` | `service_role` | `x-cron-secret` header auth; marks overdue follow-ups across all orgs |
| `/api/users/*` | `app_user` | RBAC checks on role comparisons before write |
| `/api/intake/webhook` | `app_user` | API key auth (not JWT) |
| `/api/dashboard/*` | `tenant_admin` | `tenant_admin` role required |
| `/api/assignments/*` | `app_user` | `senior_sales_executive`+ via `requireMinimumRoleApi` |

---

## UI Architecture

### Hooks (`hooks/`)

| Hook | Purpose |
| ---- | ------- |
| `useDismissible(open, refs[], onClose)` | Low-level: attaches outside-click + Esc listeners. Accepts multiple refs for portal dropdowns where trigger and panel are separate DOM subtrees. |
| `useDropdown()` | High-level inline dropdown: owns `open`, `search`, `rootRef`, `searchInputRef`. Built on `useDismissible`. |
| `useAllBranches()` | Fetches `/api/branches/all` once; intended to be called in a parent and passed as props to `BranchMultiSelect`. |

### Follow-Up UI Components

| Component | Location | Purpose |
| --------- | -------- | ------- |
| `StatusChangeTrigger` | `components/leads/` | Dropdown that opens a modal for `requires_followup` statuses and `failed` |
| `FollowUpScheduleModal` | `components/leads/` | Collect follow-up details or fail reason |
| `LeadTimeline` | `components/leads/` | Renders `vw_lead_followup_timeline` events |
| `FollowUpActionModal` | `components/leads/` | Complete / reschedule / add note for a pending or missed follow-up |
| `FollowUpPipeline` | `components/leads/` | Table of enriched rows with overdue badge; used on `/dashboard/follow-ups` |

### Dropdown Components

| Component | Notes |
| --------- | ----- |
| `MultiSelect` | Generic multi-select with search; uses `useDropdown()` |
| `BranchMultiSelect` | Branch picker; data is provided as props (never fetches internally); uses `useDropdown()` |
| `InlineAssignmentSelector` | Portal-based assignment picker for the leads table; uses `useDismissible` directly with two refs (trigger + popover are separate DOM subtrees) |

---

## Data Flows

### View Leads

```
GET /api/leads?page=1&status=new
  → middleware: verify JWT signature (Edge, no DB)
  → withRoute → requireSession(): re-read user row (Node, service_role)
  → withOrgTx(orgId, userId):
        SET LOCAL ROLE app_user;
        SET LOCAL app.current_org_id = '<orgId>';
        SELECT * FROM vw_dashboard_leads WHERE ... (RLS fires)
  → JSON { leads, total, page }
```

### Atomic Status Change + Follow-Up

```
PATCH /api/leads/[id]/status { newStatus: "qualified", followUp: { assignedUserId, scheduledAt } }
  → withRoute → requireSession()
  → withOrgTx(orgId, userId, async (tx) => {
        SELECT id FROM marketing_leads WHERE id = $1 AND NOT is_deleted  ← verify ownership
        SELECT id, requires_followup FROM lead_statuses WHERE name = $1  ← resolve status
        SET LOCAL app.lead_transition_note = 'optional note'
        UPDATE marketing_leads SET status_id = $1 WHERE id = $2          ← trigger fires
        SET LOCAL app.lead_transition_note = ''
        INSERT INTO lead_follow_ups (...) RETURNING id                   ← same tx
    })
  → JSON { success: true } 200
```

### Password Change

```
POST /api/auth/change-password { currentPassword, newPassword }
  → withRoute → requireSession()
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
│   ├── api/                   Route handlers (31/40 use withRoute)
│   │   ├── auth/              login, logout, me, change-password
│   │   ├── leads/             CRUD + nested status, timeline, follow-ups, interactions, assignments
│   │   │   └── [id]/
│   │   │       ├── status/    PATCH — atomic status change + optional follow-up
│   │   │       ├── timeline/  GET  — merged status-change + follow-up timeline
│   │   │       └── follow-ups/[followUpId]/  PATCH — complete/reschedule/add_note
│   │   ├── campaigns/         CRUD
│   │   ├── follow-ups/        Org-wide enriched pipeline
│   │   ├── users/             CRUD + team hierarchy + password reset
│   │   ├── assignments/       Assignment list/create/update (manager+)
│   │   ├── dashboard/         Tenant-level summary
│   │   ├── intake/            Webhook receiver (API key auth)
│   │   ├── org/               Org performance
│   │   ├── lookups/           Reference data + lead-statuses (308 redirect)
│   │   ├── branches/          Branch list + all branches
│   │   ├── admin/lead-statuses/[id]/  PATCH — toggle requires_followup (org_admin+)
│   │   └── cron/mark-missed-followups/  GET — mark overdue follow-ups as missed
│   ├── dashboard/
│   │   ├── leads/             Leads table (main view)
│   │   ├── follow-ups/        Follow-up pipeline page (overdue + all)
│   │   ├── assignments/       Assignment management (SSE+)
│   │   ├── users/             User management (SSE+)
│   │   └── ...
│   └── login/                 Login page
│
├── src/
│   ├── lib/
│   │   ├── api/
│   │   │   └── route-handler.ts  withRoute HOF — auth + error handling for API routes
│   │   ├── auth/
│   │   │   ├── session.ts     requireSession() — Node JWT + DB revalidation
│   │   │   ├── jwt.ts         signJwt, verifyJwt (Node)
│   │   │   ├── provider.ts    getUserByEmailFromProvider, getUserByIdFromProvider
│   │   │   └── db-user.ts     PostgreSQL user look-up functions
│   │   ├── db/
│   │   │   ├── client.ts      Three pool singletons (camelCase transform)
│   │   │   ├── transaction.ts withOrgTx, withTenantTx, withServiceTx
│   │   │   ├── pool-factory.ts buildPoolOptions (SSL, max, idle timeout)
│   │   │   └── queries/       One module per domain (leads, followups, status-log, ...)
│   │   ├── permissions/
│   │   │   ├── index.ts       canViewUser, canViewLeadData, canEditLead, etc.
│   │   │   ├── scope.ts       resolveActorOrgIds — org-scope resolution
│   │   │   ├── ranks.ts       RANKS constants mirroring user_roles.rank values
│   │   │   ├── server.ts      requireMinimumRole, requireMinimumRoleApi (server-only)
│   │   │   ├── leads.ts       Lead-specific permission helpers
│   │   │   ├── users.ts       User-specific permission helpers
│   │   │   └── assignments.ts canAssignToUser, canAssignLeadToBranch
│   │   └── errors.ts          AppError, NotFoundError, ForbiddenError, ValidationError
│   ├── features/
│   │   ├── auth/
│   │   │   └── constants.ts   ROLES, CANONICAL_ROLES, ROLE_TIERS, ROLE_RANK, ROLE_LABELS, isSalesRole()
│   │   ├── assignments/
│   │   │   ├── queries.ts     listAllAssignments, getLeadAssignment, getAssignmentsForUser, etc.
│   │   │   └── serializers.ts toAssignmentViews
│   │   └── users/
│   │       ├── queries.ts     listUsers, getUserById, createUser, updateUser, deleteUser
│   │       └── serializers.ts toSessionUser, toSessionUsers
│   └── types/
│       ├── auth.ts            SessionUser, UserRole, JwtPayload
│       └── database.ts        DatabaseUser and other DB row types
│
├── hooks/
│   ├── useDropdown.ts         useDismissible + useDropdown hooks
│   └── useAllBranches.ts      Fetches /api/branches/all for branch picker UIs
│
├── components/
│   ├── leads/
│   │   ├── StatusChangeTrigger.tsx
│   │   ├── FollowUpScheduleModal.tsx
│   │   ├── LeadTimeline.tsx
│   │   ├── FollowUpActionModal.tsx
│   │   └── FollowUpPipeline.tsx
│   ├── assignments/
│   │   ├── InlineAssignmentSelector.tsx  Portal-based picker; uses useDismissible
│   │   └── AssignmentsClient.tsx
│   ├── users/
│   │   └── BranchMultiSelect.tsx         Prop-based branch picker; uses useDropdown
│   └── dashboard/
│       └── MultiSelect.tsx               Generic multi-select; uses useDropdown
│
├── databse-model/             SQL schema files 00–11 (core schema + grants + seed)
├── vercel.json                Vercel Cron schedule (*/15 * * * * → mark-missed-followups)
├── middleware.ts              Edge JWT verification
├── README.md                  Architecture overview + quick-start
├── LOCAL_DEV.md               Docker-based local development guide
├── SETUP.md                   Step-by-step PostgreSQL setup guide
├── deploy_supabase.md         Vercel + Supabase-as-PostgreSQL deployment guide
└── ARCHITECTURE.md            This file
```

---

## Key Design Decisions

| Decision | Reason |
| -------- | ------ |
| `postgres` npm package, no ORM | Tagged template literals produce safe parameterised queries; `camelCase` transform eliminates `snake_case` mapping boilerplate; no schema file to keep in sync |
| Three pools, not one | Separates privilege surfaces: `app_user` (RLS on) vs `service_role` (BYPASSRLS). Limits blast radius if a connection string leaks |
| `SET LOCAL` GUCs in transactions | Passes request context (org, user, tenant) to RLS policies and audit triggers without application-level re-implementation. Resets on `COMMIT`, required for PgBouncer transaction mode |
| `app.lead_transition_note` GUC | The status-change trigger needs the transition note but `app_user` cannot write to `lead_status_log` directly. Passing the note via `SET LOCAL` GUC (read by the `SECURITY DEFINER` function) avoids an extra privilege grant |
| `SECURITY DEFINER` trigger for `lead_status_log` | `app_user` is granted no INSERT on `lead_status_log` — the table is append-only and must not be writable by application code |
| `createFollowUpInTx(tx)` separate from `createFollowUp` | `createFollowUp` calls `withOrgTx` internally and cannot be composed into an outer transaction. `createFollowUpInTx` accepts an external `tx` to enable the atomic status-change + follow-up pattern |
| Atomic status change + follow-up | If the follow-up insert fails, the status change is rolled back. A lead can never be moved to a `requires_followup` status without a scheduled follow-up |
| `withRoute` HOF | Eliminates ~7-line try/catch boilerplate repeated across 40 routes; centralises `requireSession()`, `AppError` mapping, and 500 fallback. Handles Next.js 16 `params` as `Promise` internally |
| `resolveActorOrgIds` for scope | Single function determines what org IDs an actor may see; used in both page server components and API routes so the UI and data layer never disagree |
| `ROLE_TIERS` as single source of truth | Navigation, permission checks, and UI dropdowns all import from `src/features/auth/constants.ts`. No local role arrays duplicated in individual files |
| `useDismissible` + `useDropdown` hooks | Eliminates outside-click + Esc `useEffect` duplicated across every dropdown. `useDismissible` accepts multiple refs for portal dropdowns where trigger and panel are separate DOM subtrees |
| `BranchMultiSelect` data as props | Component never fetches; parent provides `branches`/`loading`/`error` from `useAllBranches()`, enabling one fetch shared across multiple pickers |
| `pwd_iat` watermark in JWT | Password reset invalidates all prior sessions without a server-side session store; takes effect on the next DB call |
| `GENERATED ALWAYS AS STORED` for `full_name` | DB enforces the derived column; application code can never accidentally insert stale or inconsistent name data |
| Soft-delete via trigger | `DELETE` privilege is granted to `app_user`, but the trigger silently converts it to a soft-delete UPDATE |
| `resolveLookupId` allowlist + cache | Lookup table name is a runtime string; `LOOKUP_TABLES` Set prevents SQL injection via table-name substitution; module-level Map prevents repeated round-trips |
| Zod v4 `z.record` signature | Requires two type arguments: `z.record(z.string(), z.unknown())`. The single-argument form from v3 is a type error in v4 |
