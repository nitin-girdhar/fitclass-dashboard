# FitClass CRM

A multi-tenant lead management CRM built with Next.js 16 App Router. Runs on a self-hosted PostgreSQL 15+ database (or any PostgreSQL host such as Supabase) via direct connection strings — no Supabase JS SDK, no ORM.

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
      └── /api/*             Route handlers (withRoute HOF)
                │
                ├── requireSession()   Node JWT verify + DB revalidation
                └── withOrgTx / withTenantTx / withServiceTx
                              │
                              ▼
                    ┌─────────────────────────────┐
                    │  PostgreSQL 15+  (postgres.js v3) │
                    │                               │
                    │  app_user    ← SET LOCAL      │  ← CRM operations (RLS on)
                    │  tenant_admin← SET LOCAL      │  ← cross-org dashboard
                    │  service_role (BYPASSRLS)     │  ← migrations / webhooks
                    └─────────────────────────────┘
```

---

## Key Packages

| Package        | Version  | Role                                        |
| -------------- | -------- | ------------------------------------------- |
| `next`         | 16.2.6   | App Router, Edge middleware                 |
| `postgres`     | ^3.4.4   | PostgreSQL driver (NOT Drizzle, NOT Prisma) |
| `jose`         | ^6.2.3   | Edge-safe JWT verify (WebCrypto)            |
| `jsonwebtoken` | ^9.0.3   | Node-side JWT sign/verify                   |
| `bcryptjs`     | ^3.0.3   | Password hashing                            |
| `zod`          | ^4.4.3   | Request validation                          |

---

## JWT & Session

- Cookie name: `fc_session` (HTTP-only, SameSite=Lax)
- Payload: `{ sub, email, role, rank, orgId, pwd_iat }`
- `pwd_iat` = epoch seconds of `password_changed_at` at sign time; server rejects the token if the DB row is newer (password rotation invalidates all prior tokens)
- Edge middleware does a fast signature+expiry check (no DB). Route handlers re-read the user row to catch deactivations or role changes since the token was issued.

---

## PostgreSQL Role Architecture

Three connection pools, each using a different PostgreSQL role:

| Pool helper        | PostgreSQL role                | Purpose                          |
| ------------------ | ------------------------------ | -------------------------------- |
| `getAppPool()`     | `app_user` (NOLOGIN group)     | All CRM operations; RLS enforced |
| `getTenantPool()`  | `tenant_admin` (NOLOGIN group) | Cross-org tenant dashboard       |
| `getServicePool()` | `service_role` (BYPASSRLS)     | Migrations, seed, webhooks, cron |

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

Roles are stored in the `user_roles` table and resolved by name — IDs are never hardcoded. Ranks are stored in the DB and embedded in the JWT at login.

| Role                     | Rank | Access                                                     |
| ------------------------ | ---- | ---------------------------------------------------------- |
| `read_only`              | 0    | Dashboard view only                                        |
| `sales_representative`   | 20   | Own leads only; own follow-up pipeline only                |
| `senior_sales_executive` | 40   | Team leads; can assign                                     |
| `org_manager`            | 60   | Branch; routes work to sales tier                          |
| `org_sr_manager`         | 70   | Senior manager tier                                        |
| `org_admin`              | 80   | Full access within one org; can toggle `requires_followup` |
| `tenant_admin`           | 90   | Cross-org tenant dashboard                                 |
| `super_admin`            | 100  | Platform-wide                                              |

Legacy aliases (`sales_executive` → 20, `manager` → 60, `admin` → 80) are retained in the role table for JWT backward-compatibility with tokens issued before the rename migration. New users should always be assigned canonical role names.

---

## Database Schema

All schema files live in `databse-model/`. Run them in order against your database, then seed the first admin user.

### Schema files

```
00_extensions.sql    — pg_trgm, btree_gin, optional pgvector
01_roles.sql         — app_user, tenant_admin, service_role group roles
02_lookup_tables.sql — lead_statuses, user_roles, platforms, geography, etc.
03_core_tables.sql   — tenants, organizations, users, leads, campaigns, etc.
04_rls_policies.sql  — row-level security (org + tenant isolation)
05_indexes.sql       — GIN trigram, BTREE performance indexes
06_audit_triggers.sql — marketing_leads_history, soft-delete trigger, status-log trigger
07_views.sql         — vw_dashboard_leads, vw_lead_followup_timeline, etc.
08_grants.sql        — table-level GRANT/REVOKE for all service roles
09_seed_data.sql     — 2 tenants, 4 orgs, 12 users, 36 leads (dev/staging only)
10_user_hierarchy.sql — vw_user_org_chart, can_assign_to() function
11_service_logins.sql — lead_svc, campaign_svc, tenant_dash_svc, etc.
```

Key tables:

| Table                     | Notes                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `tenants`                 | Top-level tenant (gym chain / retailer)                                            |
| `organizations`           | Physical location / branch within a tenant                                         |
| `users`                   | `full_name` is `GENERATED ALWAYS AS STORED` — never insert directly                |
| `marketing_leads`         | Soft-delete via trigger (`DELETE` → `is_deleted = TRUE`)                           |
| `lead_status_log`         | Immutable record of every status transition; written by `SECURITY DEFINER` trigger |
| `lead_follow_ups`         | `completed_at` required when `status = 'completed'` (trigger enforced)             |
| `lead_interactions`       | Immutable call/chat log                                                            |
| `marketing_leads_history` | Audit trail via trigger                                                            |

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

| Method           | Path                                      | Description                                                 |
| ---------------- | ----------------------------------------- | ----------------------------------------------------------- |
| POST             | `/api/auth/login`                         | Login — sets `fc_session` cookie                            |
| POST             | `/api/auth/logout`                        | Clear session cookie                                        |
| GET              | `/api/auth/me`                            | Current session user                                        |
| POST             | `/api/auth/change-password`               | Self-service password change                                |
| GET              | `/api/leads`                              | Paginated lead list with filters                            |
| POST             | `/api/leads`                              | Create lead                                                 |
| GET/PATCH/DELETE | `/api/leads/[id]`                         | Lead detail / update / soft-delete                          |
| PATCH            | `/api/leads/[id]/status`                  | Atomic status change + optional follow-up                   |
| GET              | `/api/leads/[id]/timeline`                | Merged status-change + follow-up timeline                   |
| GET              | `/api/leads/[id]/assignment-history`      | Assignment timeline via view                                |
| GET/POST         | `/api/leads/[id]/follow-ups`              | Follow-ups per lead                                         |
| PATCH            | `/api/leads/[id]/follow-ups/[followUpId]` | Complete / reschedule / add note                            |
| GET/POST         | `/api/leads/[id]/interactions`            | Interactions per lead                                       |
| GET              | `/api/leads/[id]/assignments`             | Assignment log per lead                                     |
| GET/POST         | `/api/campaigns`                          | Campaign list / create                                      |
| GET/PATCH/DELETE | `/api/campaigns/[id]`                     | Campaign detail / update / delete                           |
| GET              | `/api/follow-ups`                         | Enriched org-wide pipeline (overdue flag, last interaction) |
| PATCH/DELETE     | `/api/follow-ups/[followUpId]`            | Update / delete follow-up                                   |
| GET              | `/api/users`                              | List org users                                              |
| POST             | `/api/users`                              | Create user                                                 |
| GET/PATCH/DELETE | `/api/users/[id]`                         | User detail / update / delete                               |
| POST             | `/api/users/[id]/reset-password`          | Admin password reset                                        |
| GET              | `/api/users/assignable`                   | Users the caller may assign leads to                        |
| GET              | `/api/users/team`                         | Team hierarchy under a manager                              |
| GET              | `/api/users/org-chart`                    | Full org chart                                              |
| GET/POST         | `/api/assignments`                        | Assignment list / create (manager+)                         |
| PATCH/DELETE     | `/api/assignments/[id]`                   | Manage assignment                                           |
| POST             | `/api/intake/webhook`                     | External lead webhook (API key auth)                        |
| GET              | `/api/dashboard`                          | Tenant dashboard (tenant_admin only)                        |
| GET              | `/api/dashboard/campaigns`                | Tenant campaign summary                                     |
| GET              | `/api/org/performance`                    | Org performance snapshot                                    |
| GET              | `/api/lookups`                            | All lookup tables                                           |
| GET              | `/api/lookups/cities`                     | Cities by state                                             |
| GET              | `/api/lookups/lead-stages`                | Lead stages                                                 |
| GET              | `/api/lookups/lead-stage-outcomes`        | Outcomes per stage                                          |
| GET              | `/api/lookups/lead-statuses`              | Lead statuses with `requires_followup` flag (308 redirect)  |
| PATCH            | `/api/admin/lead-statuses/[id]`           | Toggle `requires_followup` (org_admin+)                     |
| GET              | `/api/cron/mark-missed-followups`         | Cron: mark overdue follow-ups as missed                     |
| GET              | `/api/branches`                           | Branch list                                                 |
| GET              | `/api/branches/all`                       | All branches (for picker UIs)                               |
| GET              | `/api/locations`                          | Location lookup                                             |
| GET              | `/api/lead-sources`                       | Lead source lookup                                          |

---

## Quick Start

```bash
# 1. Install
npm install

# 2. Configure
# Create .env.local — minimum required vars:
DATABASE_URL=postgres://lead_svc:password@host:5432/crm
DATABASE_URL_TENANT=postgres://tenant_dash_svc:password@host:5432/crm
DATABASE_URL_SERVICE=postgres://service_role:password@host:5432/crm
DATABASE_URL_ANALYTICS=postgres://analytics_svc:password@host:5432/crm
JWT_SECRET=<at-least-48-random-chars>
BCRYPT_ROUNDS=12
CRON_SECRET=<random-string>
NEXT_PUBLIC_APP_URL=http://localhost:3000

# 3. Set up the database
# Apply databse-model/00_extensions.sql through 11_service_logins.sql in order
# (09_seed_data.sql is optional — dev/staging only)

# 4. Seed the first admin user
# Requires SEED_ORG_ID, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD in .env.local
npm run db:seed-admin

# 5. Start
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You will be redirected to `/login`.

For Docker-based local setup, see [LOCAL_DEV.md](./LOCAL_DEV.md).
For Vercel + Supabase deployment, see [deploy_supabase.md](./deploy_supabase.md).

---

## Scripts

| Script                  | Description                                                                 |
| ----------------------- | --------------------------------------------------------------------------- |
| `npm run dev`           | Next.js development server                                                  |
| `npm run build`         | Production build                                                            |
| `npm run start`         | Production server                                                           |
| `npm run db:seed-admin` | Create first admin user (reads `SEED_ORG_ID`, `SEED_ADMIN_*` from env)     |
