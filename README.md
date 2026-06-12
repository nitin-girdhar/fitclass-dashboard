# FitClass CRM

A multi-tenant lead management CRM built with Next.js 16 App Router. Supports two operating modes selected by environment variables — a fully self-hosted **PostgreSQL-native** path and a legacy **Supabase** path kept for the migration period.

---

## Architecture Overview

```
Browser / Mobile
      │
      ▼
  middleware.ts  ──  Edge JWT verify (jose / WebCrypto)
      │                 Cookie: fc_session
      ▼
  Next.js App Router  (app/)
      │
      ├── /dashboard/*       Server pages + components
      └── /api/*             Route handlers
                │
                ├── requireSession()   Node JWT verify + DB revalidation
                └── withOrgTx / withTenantTx / withServiceTx
                              │
                              ▼
                    ┌─────────────────────────┐
                    │  PostgreSQL  (postgres v3) │
                    │                           │
                    │  app_user    ← SET LOCAL  │  ← CRM operations (RLS on)
                    │  tenant_admin← SET LOCAL  │  ← cross-org dashboard
                    │  service_role (BYPASSRLS) │  ← migrations / webhooks
                    └─────────────────────────┘
```

### Dual-Provider Switch

| Env var | Value | Effect |
|---|---|---|
| `AUTH_PROVIDER` | `local` | PostgreSQL-native JWT auth (recommended) |
| `AUTH_PROVIDER` | `supabase` | Legacy Supabase auth (migration fallback) |
| `DB_PROVIDER` | `local` | Self-hosted PostgreSQL connection strings |
| `DB_PROVIDER` | `supabase` | Supabase-hosted connection strings (SSL required) |

Both providers share the same session cookie (`fc_session`), the same middleware, and the same route handlers. Only the auth lookup path changes.

---

## Key Packages

| Package | Version | Role |
|---|---|---|
| `next` | 16.2.6 | App Router, Edge middleware |
| `postgres` | ^3.4.4 | PostgreSQL driver (NOT Drizzle, NOT Prisma) |
| `jose` | ^6.2.3 | Edge-safe JWT verify (WebCrypto) |
| `jsonwebtoken` | ^9.0.3 | Node-side JWT sign/verify |
| `bcryptjs` | ^3.0.3 | Password hashing |
| `zod` | ^4.4.3 | Request validation |
| `@supabase/supabase-js` | ^2.106.0 | Legacy path only |

---

## JWT & Session

- Cookie name: `fc_session` (HTTP-only, SameSite=Lax)
- Payload: `{ sub, email, role, orgId, pwd_iat }`
- `pwd_iat` = epoch seconds of `password_changed_at` at sign time; server rejects the token if the DB row is newer (password rotation invalidates all prior tokens)
- Edge middleware does a fast signature+expiry check (no DB). Route handlers re-read the user row to catch deactivations or role changes since the token was issued.

---

## PostgreSQL Role Architecture

Three connection pools, each using a different PostgreSQL role:

| Pool helper | PostgreSQL role | Purpose |
|---|---|---|
| `getAppPool()` | `app_user` (NOLOGIN group) | All CRM operations; RLS enforced |
| `getTenantPool()` | `tenant_admin` (NOLOGIN group) | Cross-org tenant dashboard |
| `getServicePool()` | `service_role` (BYPASSRLS) | Migrations, seed, webhooks, cron |

**Transaction pattern** (PgBouncer transaction-mode compatible):

```sql
BEGIN;
SET LOCAL ROLE app_user;
SET LOCAL app.current_org_id  = '<uuid>';
SET LOCAL app.current_user_id = '<uuid>';
-- DML here (RLS fires on app.current_org_id)
COMMIT;
```

The Node helpers `withOrgTx(orgId, userId, fn)`, `withTenantTx(tenantId, userId, fn)`, and `withServiceTx(fn)` wrap this pattern.

---

## User Roles

Roles are stored in the `user_roles` table and resolved by name — IDs are never hardcoded.

| Role | Rank | Access |
|---|---|---|
| `read_only` | 0 | Dashboard view only |
| `sales_rep` | 1 | Own leads only; own follow-up pipeline only |
| `senior_sales_executive` | 2 | Team leads; can assign |
| `org_manager` | 3 | Branch; routes work to sales tier |
| `org_admin` | 4 | Full access within one org; can toggle `requires_followup` |
| `tenant_admin` | 5 | Cross-org tenant dashboard |
| `super_admin` | 6 | Platform-wide |
| `sales_executive` | 1 | Legacy Supabase alias |
| `manager` | 3 | Legacy Supabase alias |
| `admin` | 4 | Legacy Supabase alias |

---

## Database Schema (PostgreSQL path)

Migration files live in `databse-model/`. Run them in order, then apply the app-level migrations in `src/lib/db/migrations/`.

### Core schema (`databse-model/`)

```
00_extensions.sql    — pg_trgm, btree_gin, optional pgvector
01_lookup_tables.sql — lead_statuses, user_roles, platforms, etc.
02_core_tables.sql   — tenants, organizations, users, leads, etc.
03_rls_policies.sql  — row-level security policies
04_indexes.sql       — GIN/BTREE performance indexes
05_audit_triggers.sql — marketing_leads_history, audit_log
06_views.sql         — vw_dashboard_leads, vw_sales_follow_up_pipeline, etc.
07_roles_and_grants.sql — app_user, tenant_admin, service_role + table grants
08_seed_data.sql     — 2 tenants, 4 orgs, 12 users, 36 leads, interactions, follow-ups
09_user_hierarchy.sql — vw_user_org_chart, can_assign_to() function
10_service_logins.sql — lead_svc, campaign_svc, user_mgmt_svc, intake_svc, etc.
```

### App-level migrations (`src/lib/db/migrations/`)

```
001_add_auth_columns.sql   — password_hash, password_changed_at on users
002_followup_system.sql    — requires_followup flag, lead_status_log table,
                             status-change trigger, vw_lead_followup_timeline,
                             vw_followup_pipeline_enriched
```

Apply via the migration runner:

```bash
npx tsx src/lib/db/migrations/apply.ts
```

Or call `applyMigrations()` from a startup script (it is idempotent — skips already-applied files).

Key tables:

| Table | Notes |
|---|---|
| `tenants` | Top-level tenant (gym chain / retailer) |
| `organizations` | Physical location / branch within a tenant |
| `users` | `full_name` is `GENERATED ALWAYS AS STORED` — never insert directly |
| `marketing_leads` | Soft-delete via trigger (`DELETE` → `is_deleted = TRUE`) |
| `lead_status_log` | Immutable record of every status transition; written by `SECURITY DEFINER` trigger |
| `lead_follow_ups` | `completed_at` required when `status = 'completed'` (trigger enforced) |
| `lead_interactions` | Immutable call/chat log |
| `marketing_leads_history` | Audit trail via trigger |

---

## Follow-Up System

Status transitions are atomic: when a lead is moved to a status with `requires_followup = true`, the follow-up is scheduled in the **same database transaction** as the status change. If either write fails, both are rolled back.

The `app.lead_transition_note` GUC is set via `SET LOCAL` before the lead UPDATE and read by the `SECURITY DEFINER` trigger `log_lead_status_change`, which writes to `lead_status_log`. `app_user` cannot write to `lead_status_log` directly — the trigger does it on their behalf.

UI flow:
1. User selects a new status in the `StatusChangeTrigger` dropdown
2. If the status has `requires_followup = true` **or** is `failed`, a modal opens
3. For `requires_followup` statuses: user fills in assignee, scheduled time, and optional notes
4. For `failed`: user selects a fail reason (required) and optional note
5. `PATCH /api/leads/[id]/status` commits the status change + follow-up atomically

---

## API Route Map

All routes require `AUTH_PROVIDER=local` (return 400 otherwise) except the Supabase auth path.

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Login (both providers) |
| POST | `/api/auth/logout` | Clear session cookie |
| POST | `/api/auth/change-password` | Self-service password change |
| GET | `/api/leads` | Paginated lead list with filters |
| POST | `/api/leads` | Create lead |
| GET/PATCH/DELETE | `/api/leads/[id]` | Lead detail / update / soft-delete |
| **PATCH** | **`/api/leads/[id]/status`** | **Atomic status change + optional follow-up** |
| **GET** | **`/api/leads/[id]/timeline`** | **Merged status-change + follow-up timeline** |
| GET | `/api/leads/[id]/assignment-history` | Assignment timeline via view |
| GET/POST | `/api/leads/[id]/follow-ups` | Follow-ups per lead |
| PATCH | `/api/leads/[id]/follow-ups/[followUpId]` | Complete / reschedule / add note |
| GET/POST | `/api/leads/[id]/interactions` | Interactions per lead |
| GET | `/api/leads/[id]/assignments` | Assignment log per lead |
| GET/POST | `/api/campaigns` | Campaign list / create |
| GET/PATCH/DELETE | `/api/campaigns/[id]` | Campaign detail / update / delete |
| GET | `/api/follow-ups` | Enriched org-wide pipeline (overdue flag, last interaction) |
| PATCH/DELETE | `/api/follow-ups/[followUpId]` | Update / delete follow-up |
| GET | `/api/users` | List org users |
| POST | `/api/users` | Create user |
| GET/PATCH/DELETE | `/api/users/[id]` | User detail / update / delete |
| GET | `/api/users/assignable` | Users the caller may assign leads to |
| GET | `/api/users/team` | Team hierarchy under a manager |
| GET | `/api/users/org-chart` | Full org chart |
| GET | `/api/users/[id]/reset-password` | Admin password reset |
| POST | `/api/intake/webhook` | External lead webhook (API key auth) |
| GET | `/api/dashboard` | Tenant dashboard (tenant_admin only) |
| GET | `/api/dashboard/campaigns` | Tenant campaign summary |
| GET | `/api/org/performance` | Org performance snapshot |
| GET | `/api/lookups` | All lookup tables |
| GET | `/api/lookups/cities` | Cities by state |
| **GET** | **`/api/lookups/lead-statuses`** | **Lead statuses with `requires_followup` flag** |
| **PATCH** | **`/api/admin/lead-statuses/[id]`** | **Toggle `requires_followup` (org_admin+)** |
| **GET** | **`/api/cron/mark-missed-followups`** | **Cron: mark overdue follow-ups as missed** |
| GET | `/api/branches` | Branch list |
| GET | `/api/branches/all` | All branches |
| GET | `/api/sheets` | Google Sheets data (legacy) |
| POST | `/api/transfer` | Lead transfer (legacy) |
| GET | `/api/assignments` | Assignment list |
| PATCH/DELETE | `/api/assignments/[id]` | Manage assignment |

New routes added by the follow-up system are **bolded** above.

---

## Quick Start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.local.example .env.local
# Fill in DATABASE_URL, JWT_SECRET, CRON_SECRET at minimum

# 3. Set up the database (PostgreSQL path)
# Run databse-model/00_*.sql through 10_*.sql against your database
# Then apply app-level migrations:
npx tsx src/lib/db/migrations/apply.ts

# 4. Seed the first admin user
npm run db:seed-admin

# 5. Start
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You will be redirected to `/login`.

---

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Next.js development server |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm run db:seed-admin` | Create first admin user (reads `SEED_ADMIN_*` env vars) |
