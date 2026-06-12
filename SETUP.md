# FitClass CRM — Setup Guide

Two independent setup paths. Pick one and follow it end to end:

- **[Path A: PostgreSQL-native](#path-a-postgresql-native)** — recommended for all new deployments. Self-hosted PostgreSQL, JWT auth, no external dependency.
- **[Path B: Legacy Supabase](#path-b-legacy-supabase)** — kept for teams already on Supabase. Uses Supabase auth + Supabase-hosted PostgreSQL. Limited features (some API routes are disabled on this path).

---

## Prerequisites

| Both paths | PostgreSQL path only |
|---|---|
| Node.js 20+ | PostgreSQL 15+ |
| npm 10+ | psql client |
| — | (optional) PgBouncer 1.21+ |

---

## Path A: PostgreSQL-native

`AUTH_PROVIDER=local` + `DB_PROVIDER=local`

### 1. Create the database and superuser

```sql
-- Run as a PostgreSQL superuser (e.g., postgres)
CREATE DATABASE crm_db;
```

You also need a `service_role` login (used for migrations and seed scripts). This role is created by `07_roles_and_grants.sql`, but its password must be set by you after running that file (see step 3 below).

### 2. Run core schema migrations in order

From the project root, apply each file against `crm_db` in numeric order. Each file depends on the previous.

```bash
psql -d crm_db -f databse-model/00_extensions.sql
psql -d crm_db -f databse-model/01_lookup_tables.sql
psql -d crm_db -f databse-model/02_core_tables.sql
psql -d crm_db -f databse-model/03_rls_policies.sql
psql -d crm_db -f databse-model/04_indexes.sql
psql -d crm_db -f databse-model/05_audit_triggers.sql
psql -d crm_db -f databse-model/06_views.sql
psql -d crm_db -f databse-model/07_roles_and_grants.sql
psql -d crm_db -f databse-model/08_seed_data.sql
psql -d crm_db -f databse-model/09_user_hierarchy.sql
psql -d crm_db -f databse-model/10_service_logins.sql
```

What each file sets up:

| File | Contents |
|---|---|
| `00_extensions.sql` | `pg_trgm`, `btree_gin`, optional `pgvector` |
| `01_lookup_tables.sql` | `lead_statuses`, `user_roles`, `marketing_platforms`, `campaign_statuses`, etc. |
| `02_core_tables.sql` | `tenants`, `organizations`, `users`, `marketing_leads`, `lead_follow_ups`, `lead_interactions`, `ad_campaigns`, `lead_assignment_log` |
| `03_rls_policies.sql` | Row-level security policies on all tables; policies fire on `app.current_org_id` GUC |
| `04_indexes.sql` | GIN trigram indexes on leads, BTREE indexes on foreign keys |
| `05_audit_triggers.sql` | `marketing_leads_history` audit table; soft-delete trigger (`DELETE` → `is_deleted = TRUE`) |
| `06_views.sql` | `vw_dashboard_leads`, `vw_sales_follow_up_pipeline`, `vw_lead_assignment_timeline`, others |
| `07_roles_and_grants.sql` | `app_user` (NOLOGIN), `tenant_admin` (NOLOGIN), `service_role` (LOGIN BYPASSRLS) + all GRANT statements |
| `08_seed_data.sql` | 2 tenants, 4 orgs, 12 users, 36 leads, sample interactions and follow-ups |
| `09_user_hierarchy.sql` | `vw_user_org_chart` view, `can_assign_to()` function |
| `10_service_logins.sql` | 7 service login roles: `lead_svc`, `campaign_svc`, `user_mgmt_svc`, `notif_svc`, `intake_svc`, `tenant_dash_svc`, `analytics_svc` |

**Skip `08_seed_data.sql` in production** — it inserts development data (dummy tenants, orgs, users, and leads). Only run it in development or staging.

### 3. Rotate service login passwords

All service roles are created with the placeholder password `replace_in_env`. You must set real passwords before the application can connect. Run this as a PostgreSQL superuser:

```sql
ALTER ROLE service_role    WITH PASSWORD 'your_service_role_password';
ALTER ROLE lead_svc        WITH PASSWORD 'your_lead_svc_password';
ALTER ROLE campaign_svc    WITH PASSWORD 'your_campaign_svc_password';
ALTER ROLE user_mgmt_svc   WITH PASSWORD 'your_user_mgmt_password';
ALTER ROLE notif_svc       WITH PASSWORD 'your_notif_svc_password';
ALTER ROLE intake_svc      WITH PASSWORD 'your_intake_svc_password';
ALTER ROLE tenant_dash_svc WITH PASSWORD 'your_tenant_dash_password';
ALTER ROLE analytics_svc   WITH PASSWORD 'your_analytics_svc_password';
```

Use long random passwords (32+ chars). Store them only in your secrets manager or `.env.local` — never in version control.

### 4. Configure environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```dotenv
AUTH_PROVIDER=local
DB_PROVIDER=local

# app_user-group connection — route through PgBouncer in production
DATABASE_URL=postgres://lead_svc:your_lead_svc_password@localhost:5432/crm_db

# tenant_admin-group connection (cross-org tenant dashboard)
DATABASE_URL_TENANT=postgres://tenant_dash_svc:your_tenant_dash_password@localhost:5432/crm_db

# service_role — MUST connect directly to the primary (bypass PgBouncer)
# service_role uses named prepared statements that are incompatible with
# PgBouncer transaction mode
DATABASE_URL_SERVICE=postgres://service_role:your_service_role_password@localhost:5432/crm_db

# analytics_svc — point to a read replica in production
DATABASE_URL_ANALYTICS=postgres://analytics_svc:your_analytics_svc_password@localhost:5432/crm_db

# Pool tuning
PG_MAX=10
PG_IDLE_TIMEOUT=30

# Generate with: openssl rand -base64 48
JWT_SECRET=your_64_char_random_secret

BCRYPT_ROUNDS=12
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Cron secret — sent as x-cron-secret header by the scheduler (Vercel Cron / cURL)
# Generate with: openssl rand -base64 32
CRON_SECRET=your_cron_secret

# Admin seed — used only by npm run db:seed-admin
SEED_ADMIN_EMAIL=admin@yourdomain.com
SEED_ADMIN_PASSWORD=your_initial_admin_password
SEED_ADMIN_NAME=FitClass Admin
```

Leave the `NEXT_PUBLIC_SUPABASE_*` and `SUPABASE_SERVICE_ROLE_KEY` variables empty or absent — they are not used on this path.

### 5. Apply app-level migrations

After the core schema is in place, apply the app-level migrations from `src/lib/db/migrations/`. The migration runner reads all `.sql` files in that directory and applies them in alphabetical order, skipping any that have already been applied (idempotent on "already exists" errors).

```bash
npx tsx src/lib/db/migrations/apply.ts
```

This applies:

| File | Contents |
|---|---|
| `001_add_auth_columns.sql` | `password_hash`, `password_changed_at` columns on `users` |
| `002_followup_system.sql` | `requires_followup` flag on `lead_statuses`; `lead_status_log` table with RLS; `SECURITY DEFINER` trigger that logs every status transition; `vw_lead_followup_timeline` and `vw_followup_pipeline_enriched` views |

You can also apply a specific file manually if you need to:

```bash
psql -d crm_db -f src/lib/db/migrations/002_followup_system.sql
```

### 6. Seed the first admin user

```bash
npm run db:seed-admin
```

This creates an `org_admin` user using the `SEED_ADMIN_*` env vars. It is idempotent — safe to re-run if the first attempt fails.

### 7. Install and start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with the credentials from step 6.

---

### PgBouncer (production)

In production, route `DATABASE_URL`, `DATABASE_URL_TENANT`, and `DATABASE_URL_ANALYTICS` through PgBouncer in **transaction mode**. Never route `DATABASE_URL_SERVICE` through PgBouncer.

Example `pgbouncer.ini`:

```ini
[databases]
crm_lead        = host=pg-primary.internal dbname=crm_db user=lead_svc
crm_campaign    = host=pg-primary.internal dbname=crm_db user=campaign_svc
crm_user_mgmt   = host=pg-primary.internal dbname=crm_db user=user_mgmt_svc
crm_notif       = host=pg-primary.internal dbname=crm_db user=notif_svc
crm_intake      = host=pg-primary.internal dbname=crm_db user=intake_svc
crm_tenant_dash = host=pg-primary.internal dbname=crm_db user=tenant_dash_svc
crm_analytics   = host=pg-replica.internal  dbname=crm_db user=analytics_svc

[pgbouncer]
pool_mode = transaction
; Suggested pool sizes per service:
; lead_svc=15, intake_svc=20, notif_svc=8, campaign_svc=10,
; user_mgmt_svc=10, tenant_dash_svc=5, analytics_svc=5
default_pool_size = 10
```

The application uses `SET LOCAL` (not `SET`) for all GUC assignments — required for transaction-mode pooling. PgBouncer resets `SET LOCAL` state after every `COMMIT`.

---

### Vercel Cron (production)

The follow-up system includes a cron endpoint (`GET /api/cron/mark-missed-followups`) that marks overdue follow-ups as missed. In production, this is driven by Vercel Cron via `vercel.json` (every 15 minutes). The endpoint validates the `x-cron-secret` header against `CRON_SECRET`.

Add `CRON_SECRET` to your Vercel project's environment variables so Vercel Cron can authenticate the request. To trigger the cron manually during development:

```bash
curl -H "x-cron-secret: your_cron_secret" http://localhost:3000/api/cron/mark-missed-followups
```

---

## Path B: Legacy Supabase

`AUTH_PROVIDER=supabase` + `DB_PROVIDER=supabase`

This path uses Supabase for authentication and hosts PostgreSQL on Supabase infrastructure. Some API routes return HTTP 400 when `AUTH_PROVIDER !== "local"`. This path is kept for the migration period — new deployments should use Path A.

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com), create a new project, and note:
- Project URL: `https://<project-ref>.supabase.co`
- Anon key (public, safe to expose)
- Service role key (secret — never expose to the browser)

### 2. Apply migrations

Apply the files in `supabase/migrations/` in chronological order. Using the Supabase CLI:

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Or apply manually through the Supabase SQL editor in this order:

```
20260519000000_init_auth_schema.sql            — base schema: users, leads, orgs
20260520000000_activities_audit_extensions.sql — activity log + extensions
20260521000000_assignments_branch_and_uniqueness.sql — assignment constraints
20260522000000_add_sales_role_levels_enum.sql  — role enum additions
20260522000001_backfill_sales_to_sales_executive.sql — role data backfill
20260523000000_create_sheet_assignments.sql    — legacy sheet assignment tables
20260524000000_finalize_user_role_enum.sql     — finalize role type
20260524000001_finalize_role_data_backfill.sql — role backfill completion
20260525000000_password_rotation.sql           — password_changed_at column
```

### 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```dotenv
AUTH_PROVIDER=supabase
DB_PROVIDER=supabase

# Supabase project URL and anon key — safe to expose to the browser
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Service role key — never expose to the browser; bypasses ALL RLS
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Supabase provides two connection string formats:
# Transaction pooler (port 6543) — use for DATABASE_URL (app operations)
# Direct connection  (port 5432) — use for DATABASE_URL_SERVICE (migrations / seed)
DATABASE_URL=postgres://postgres.<project-ref>:your_db_password@aws-0-<region>.pooler.supabase.com:6543/postgres
DATABASE_URL_SERVICE=postgres://postgres.<project-ref>:your_db_password@aws-0-<region>.pooler.supabase.com:5432/postgres

# Not required on the Supabase path but leave harmless placeholders
DATABASE_URL_TENANT=
DATABASE_URL_ANALYTICS=

# Not used for Supabase auth but the env var must be present
JWT_SECRET=any_random_string

BCRYPT_ROUNDS=12
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Find your connection strings in **Supabase dashboard → Project Settings → Database → Connection string**.

### 4. Install and start

```bash
npm install
npm run dev
```

Log in with a user present in your Supabase `users` table, or create one through the Supabase Auth dashboard.

---

## Environment Variable Reference

| Variable | Required on | Description |
|---|---|---|
| `AUTH_PROVIDER` | Both | `local` or `supabase` (defaults to `supabase` if unset) |
| `DB_PROVIDER` | Both | `local` or `supabase` |
| `DATABASE_URL` | Both | app_user / lead_svc connection string |
| `DATABASE_URL_TENANT` | Path A | tenant_dash_svc connection string |
| `DATABASE_URL_SERVICE` | Both | service_role direct connection string |
| `DATABASE_URL_ANALYTICS` | Path A | analytics_svc read-replica connection string |
| `PG_MAX` | Both | Max connections per pool (default 10) |
| `PG_IDLE_TIMEOUT` | Both | Pool idle timeout in seconds (default 30) |
| `JWT_SECRET` | Path A | HMAC-SHA256 key — generate with `openssl rand -base64 48` |
| `BCRYPT_ROUNDS` | Path A | bcrypt work factor (12 recommended; 10–14 for production) |
| `NEXT_PUBLIC_APP_URL` | Both | Base URL for link generation |
| `CRON_SECRET` | Path A | Secret validated by `GET /api/cron/mark-missed-followups`; set in Vercel env vars for Vercel Cron |
| `NEXT_PUBLIC_SUPABASE_URL` | Path B | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Path B | Supabase anon key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Path B | Supabase service role key (secret) |
| `SEED_ADMIN_EMAIL` | Seed only | First admin email |
| `SEED_ADMIN_PASSWORD` | Seed only | First admin password |
| `SEED_ADMIN_NAME` | Seed only | First admin display name (default: `FitClass Admin`) |

---

## Development Scripts

```bash
npm run dev              # Start dev server on :3000 with hot reload
npm run build            # Production build (also runs tsc)
npm run start            # Serve the production build
npm run db:seed-admin    # Create or re-seed the first admin user
```

TypeScript strict mode is enabled. Run `npx tsc --noEmit` to check for type errors without producing output files.

---

## Production Checklist (Path A)

- [ ] All service login passwords changed from `replace_in_env`
- [ ] `service_role` password set (created by `07_roles_and_grants.sql` with no password)
- [ ] `JWT_SECRET` is at least 48 bytes of random data (`openssl rand -base64 48`)
- [ ] `BCRYPT_ROUNDS` is 12 or higher
- [ ] `DATABASE_URL_SERVICE` bypasses PgBouncer (direct connection to primary)
- [ ] `DATABASE_URL_ANALYTICS` points to a read replica
- [ ] `08_seed_data.sql` was NOT applied to the production database
- [ ] `SEED_ADMIN_*` variables removed or rotated after first admin is created
- [ ] `NEXT_PUBLIC_APP_URL` set to the production domain
- [ ] TLS enforced on all database connections (append `?sslmode=require` to connection strings)
- [ ] App-level migrations applied: `npx tsx src/lib/db/migrations/apply.ts`
- [ ] `CRON_SECRET` set in Vercel environment variables (used by Vercel Cron for the mark-missed-followups job)
- [ ] Vercel Cron enabled: `vercel.json` schedule `*/15 * * * *` points to `/api/cron/mark-missed-followups`
