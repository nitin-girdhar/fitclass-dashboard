# FitClass CRM — Setup Guide

This guide covers setting up the CRM against a self-hosted PostgreSQL 15+ database. The application works with any PostgreSQL host: local Docker (see [LOCAL_DEV.md](./LOCAL_DEV.md)), self-hosted, or Supabase used as a managed PostgreSQL instance via connection strings (see [deploy_supabase.md](./deploy_supabase.md)).

---

## Prerequisites

| Required | Notes |
|---|---|
| Node.js 20+ | `node -v` to verify |
| npm 10+ | `npm -v` to verify |
| PostgreSQL 15+ | Any host; `psql` client for running migrations |

---

## Step 1 — Create the database

```sql
-- Run as a PostgreSQL superuser (e.g., postgres)
CREATE DATABASE crm;
```

---

## Step 2 — Run schema migrations in order

Apply each file from `databse-model/` against `crm` in numeric order. Each file depends on the previous.

```bash
psql -d crm -f databse-model/00_extensions.sql
psql -d crm -f databse-model/01_roles.sql
psql -d crm -f databse-model/02_lookup_tables.sql
psql -d crm -f databse-model/03_core_tables.sql
psql -d crm -f databse-model/04_rls_policies.sql
psql -d crm -f databse-model/05_indexes.sql
psql -d crm -f databse-model/06_audit_triggers.sql
psql -d crm -f databse-model/07_views.sql
psql -d crm -f databse-model/08_grants.sql
psql -d crm -f databse-model/10_user_hierarchy.sql
psql -d crm -f databse-model/11_service_logins.sql
# 09_seed_data.sql — dev/staging only (inserts demo tenants, orgs, users, leads)
```

What each file sets up:

| File | Contents |
|---|---|
| `00_extensions.sql` | `pg_trgm`, `btree_gin`, optional `pgvector` |
| `01_roles.sql` | Group roles: `app_user` (NOLOGIN), `tenant_admin` (NOLOGIN), `service_role` (LOGIN BYPASSRLS) |
| `02_lookup_tables.sql` | `lead_statuses`, `user_roles`, `marketing_platforms`, `campaign_statuses`, geography, etc. |
| `03_core_tables.sql` | `tenants`, `organizations`, `users`, `marketing_leads`, `lead_follow_ups`, `lead_interactions`, `ad_campaigns`, `lead_assignment_log` |
| `04_rls_policies.sql` | Row-level security policies on all tables; policies fire on `app.current_org_id` GUC |
| `05_indexes.sql` | GIN trigram indexes on leads, BTREE indexes on foreign keys |
| `06_audit_triggers.sql` | `marketing_leads_history` audit table; soft-delete trigger; `SECURITY DEFINER` status-log trigger |
| `07_views.sql` | `vw_dashboard_leads`, `vw_lead_followup_timeline`, `vw_followup_pipeline_enriched`, `vw_user_org_chart`, others |
| `08_grants.sql` | Table-level `GRANT`/`REVOKE` for all service roles — run after all tables and views exist |
| `09_seed_data.sql` | 2 tenants, 4 orgs, 12 users, 36 leads — **skip in production** |
| `10_user_hierarchy.sql` | `vw_user_org_chart` view, `can_assign_to()` function, manager adjacency list |
| `11_service_logins.sql` | 7 login roles: `lead_svc`, `campaign_svc`, `user_mgmt_svc`, `notif_svc`, `intake_svc`, `tenant_dash_svc`, `analytics_svc` |

---

## Step 3 — Set service login passwords

All service roles are created with the placeholder password `replace_in_env`. Set real passwords before the application can connect. Run as a PostgreSQL superuser:

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

Use long random passwords (32+ chars). Store them only in your secrets manager or `.env.local` — never commit them.

---

## Step 4 — Configure environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```dotenv
# app_user-group connection — route through PgBouncer in production
DATABASE_URL=postgres://lead_svc:your_lead_svc_password@localhost:5432/crm

# tenant_admin-group connection (cross-org tenant dashboard)
DATABASE_URL_TENANT=postgres://tenant_dash_svc:your_tenant_dash_password@localhost:5432/crm

# service_role — MUST connect directly to the primary (bypass PgBouncer)
DATABASE_URL_SERVICE=postgres://service_role:your_service_role_password@localhost:5432/crm

# analytics_svc — point to a read replica in production
DATABASE_URL_ANALYTICS=postgres://analytics_svc:your_analytics_svc_password@localhost:5432/crm

# Pool tuning
PG_MAX=10
PG_IDLE_TIMEOUT=30

# Generate with: openssl rand -base64 48
JWT_SECRET=your_64_char_random_secret

BCRYPT_ROUNDS=12
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Cron secret — sent as x-cron-secret header by the scheduler
# Generate with: openssl rand -base64 32
CRON_SECRET=your_cron_secret

# Admin seed — used only by npm run db:seed-admin
SEED_ORG_ID=<uuid-of-an-existing-org>
SEED_ADMIN_EMAIL=admin@yourdomain.com
SEED_ADMIN_PASSWORD=your_initial_admin_password
SEED_ADMIN_NAME=FitClass Admin
```

---

## Step 5 — Seed the first admin user

```bash
npm run db:seed-admin
```

This creates an `org_admin` user using the `SEED_ADMIN_*` and `SEED_ORG_ID` env vars. It is idempotent — safe to re-run if the first attempt fails.

To find an org UUID (if you ran `09_seed_data.sql`):

```sql
SELECT id, name FROM organizations LIMIT 10;
```

---

## Step 6 — Install and start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with the credentials from step 5.

---

## PgBouncer (production)

In production, route `DATABASE_URL`, `DATABASE_URL_TENANT`, and `DATABASE_URL_ANALYTICS` through PgBouncer in **transaction mode**. Never route `DATABASE_URL_SERVICE` through PgBouncer — `service_role` uses named prepared statements that are incompatible with PgBouncer transaction mode.

Example `pgbouncer.ini`:

```ini
[databases]
crm_lead        = host=pg-primary.internal dbname=crm user=lead_svc
crm_campaign    = host=pg-primary.internal dbname=crm user=campaign_svc
crm_user_mgmt   = host=pg-primary.internal dbname=crm user=user_mgmt_svc
crm_tenant_dash = host=pg-primary.internal dbname=crm user=tenant_dash_svc
crm_analytics   = host=pg-replica.internal  dbname=crm user=analytics_svc

[pgbouncer]
pool_mode = transaction
default_pool_size = 10
```

The application uses `SET LOCAL` (not `SET`) for all GUC assignments — required for transaction-mode pooling. PgBouncer resets `SET LOCAL` state after every `COMMIT`.

---

## Vercel Cron (production)

The follow-up system includes a cron endpoint (`GET /api/cron/mark-missed-followups`) that marks overdue follow-ups as missed. Configure Vercel Cron via `vercel.json` (already included — runs every 15 minutes). The endpoint validates the `x-cron-secret` header against `CRON_SECRET`.

```bash
# Trigger manually during development:
curl -H "x-cron-secret: your_cron_secret" http://localhost:3000/api/cron/mark-missed-followups
```

---

## Environment Variable Reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | `lead_svc` login — single-org CRM operations |
| `DATABASE_URL_TENANT` | Yes | `tenant_dash_svc` login — cross-org tenant reporting |
| `DATABASE_URL_SERVICE` | Yes | `service_role` login — BYPASSRLS, direct connection only |
| `DATABASE_URL_ANALYTICS` | Yes | `analytics_svc` login — read-only analytics |
| `PG_MAX` | No | Max connections per pool (default: 10) |
| `PG_IDLE_TIMEOUT` | No | Idle connection timeout in seconds (default: 30) |
| `JWT_SECRET` | Yes | Signs and verifies session JWTs. Min 48 chars. Generate: `openssl rand -base64 48` |
| `BCRYPT_ROUNDS` | No | bcrypt cost factor (default: 10; use 12 in production) |
| `NEXT_PUBLIC_APP_URL` | Yes | Public URL of the deployed app (no trailing slash) |
| `CRON_SECRET` | Yes | Bearer token the cron endpoint validates against |
| `SEED_ORG_ID` | Seed only | UUID of an existing org — required by `npm run db:seed-admin` |
| `SEED_ADMIN_EMAIL` | Seed only | Email for the seeded admin account |
| `SEED_ADMIN_PASSWORD` | Seed only | Plaintext password for the seeded admin account |
| `SEED_ADMIN_NAME` | Seed only | Display name for the seeded admin account (default: `FitClass Admin`) |

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

## Production Checklist

- [ ] All service login passwords changed from `replace_in_env`
- [ ] `service_role` password set (created by `01_roles.sql`)
- [ ] `JWT_SECRET` is at least 48 bytes of random data (`openssl rand -base64 48`)
- [ ] `BCRYPT_ROUNDS` is 12 or higher
- [ ] `DATABASE_URL_SERVICE` bypasses PgBouncer (direct connection to primary)
- [ ] `DATABASE_URL_ANALYTICS` points to a read replica
- [ ] `09_seed_data.sql` was NOT applied to the production database
- [ ] `SEED_ADMIN_*` and `SEED_ORG_ID` variables removed or rotated after first admin is created
- [ ] `NEXT_PUBLIC_APP_URL` set to the production domain
- [ ] TLS enforced on all database connections (append `?sslmode=require` to connection strings)
- [ ] `CRON_SECRET` set in Vercel environment variables
- [ ] Vercel Cron enabled: `vercel.json` schedule `*/15 * * * *` points to `/api/cron/mark-missed-followups`
