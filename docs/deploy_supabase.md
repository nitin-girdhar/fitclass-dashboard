# Deploying to Vercel + Supabase PostgreSQL

This guide covers deploying the FitClass CRM Dashboard with the frontend on Vercel and the database on Supabase, used **purely as a hosted PostgreSQL instance** via standard connection strings — no Supabase SDK is used anywhere in the application.

---

## Prerequisites

- Node.js 20+ and npm installed locally
- Vercel account and the Vercel CLI (`npm i -g vercel`)
- Supabase account (free tier works for initial deployment)
- All SQL files in `databse-model/` ready to run

---

## Step 1 — Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) → **New project**
2. Choose a region closest to your users (e.g. `ap-south-1` for India)
3. Set a strong **database password** — this is the password for the `postgres` superuser
4. Wait for the project to finish provisioning (~2 minutes)

Once ready, navigate to **Project Settings → Database** and note:
- **Host** — `db.<project-ref>.supabase.co`
- **Port** — `5432` (direct)
- **Database name** — `postgres` (Supabase default, not `crm_db`)
- **User** — `postgres`

---

## Step 2 — Run Database Migrations

Open the **Supabase SQL Editor** (Dashboard → SQL Editor → New Query). Execute each file below **in order**, one at a time. All scripts are idempotent and safe to re-run.

### Execution order

| Order | File | Notes |
|-------|------|-------|
| 1 | `databse-model/00_extensions.sql` | Installs `pg_trgm`, `btree_gin`. `pgvector` is commented out — ignore if it errors. |
| 2 | `databse-model/01_roles.sql` | Creates group roles. See note below about `service_role`. |
| 3 | `databse-model/02_lookup_tables.sql` | Dimension tables and seed data (statuses, platforms, roles, geography). |
| 4 | `databse-model/03_core_tables.sql` | All core application tables (users, leads, campaigns, etc.). |
| 5 | `databse-model/04_rls_policies.sql` | Row-Level Security policies for org and tenant isolation. |
| 6 | `databse-model/05_indexes.sql` | Performance indexes (partial, GIN, composite). |
| 7 | `databse-model/06_audit_triggers.sql` | Audit trail triggers for marketing_leads, status changes, and other tables. |
| 8 | `databse-model/07_views.sql` | Dashboard and reporting views (`vw_dashboard_leads`, `vw_tenant_full_dashboard`, etc.). |
| 9 | `databse-model/08_grants.sql` | Table-level GRANT/REVOKE for all service roles. Run **after** all tables and views exist. |
| 10 | `databse-model/10_user_hierarchy.sql` | Manager hierarchy, assignment log, `can_assign_to()` function, org-chart views. |
| 11 | `databse-model/11_service_logins.sql` | Creates the 7 service login roles. Run **after** `08_grants.sql`. |
| 12 | `databse-model/09_seed_data.sql` | Sample data: 2 tenants, 4 orgs, 31 users, 36 leads. Run **last**. |

### Important: `service_role` name conflict on Supabase

Supabase projects come with a built-in system role named `service_role` that Supabase manages internally. **You cannot set a custom password on it** on the free tier (and it is not recommended on any tier). Do not use the Supabase built-in `service_role` for the `DATABASE_URL_SERVICE` connection.

Instead, **before running `01_roles.sql`**, comment out the entire `service_role` block:

```sql
-- In 01_roles.sql, comment out this block before running on Supabase:
-- DO $$
-- BEGIN
--     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
--         CREATE ROLE service_role WITH LOGIN PASSWORD 'replace_in_env' BYPASSRLS;
--     ELSE
--         ALTER ROLE service_role WITH LOGIN BYPASSRLS;
--     END IF;
-- END;
-- $$;
```

Then, **after running `08_grants.sql`**, create a custom replacement role named `crm_svc` with the same BYPASSRLS privileges:

```sql
-- Run in SQL Editor after 08_grants.sql
CREATE ROLE crm_svc WITH LOGIN PASSWORD 'STRONG_CRM_SVC_PASSWORD' BYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public TO crm_svc;
GRANT CONNECT ON DATABASE postgres TO crm_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO crm_svc;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO crm_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO crm_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO crm_svc;
```

Use `crm_svc` everywhere you see `service_role` in connection strings below.

---

## Step 3 — Set Service Role Passwords

All service login roles are created with the placeholder password `replace_in_env`. **Rotate all passwords before connecting from production.** Run in the SQL Editor as `postgres`:

```sql
-- crm_svc password was already set during its CREATE ROLE above
ALTER ROLE lead_svc        WITH PASSWORD 'STRONG_LEAD_SVC_PASSWORD';
ALTER ROLE campaign_svc    WITH PASSWORD 'STRONG_CAMPAIGN_SVC_PASSWORD';
ALTER ROLE user_mgmt_svc   WITH PASSWORD 'STRONG_USER_MGMT_PASSWORD';
ALTER ROLE notif_svc       WITH PASSWORD 'STRONG_NOTIF_SVC_PASSWORD';
ALTER ROLE intake_svc      WITH PASSWORD 'STRONG_INTAKE_SVC_PASSWORD';
ALTER ROLE tenant_dash_svc WITH PASSWORD 'STRONG_TENANT_DASH_PASSWORD';
ALTER ROLE analytics_svc   WITH PASSWORD 'STRONG_ANALYTICS_SVC_PASSWORD';
```

Generate strong passwords with: `openssl rand -base64 32`

---

## Step 4 — Determine Connection Strings

### Connection types on Supabase

Supabase offers three ways to connect to its PostgreSQL instance:

| Type | Host | Port | Username format |
|------|------|------|----------------|
| **Direct** | `db.<ref>.supabase.co` | `5432` | `rolename` |
| **Session-mode pooler** | `aws-0-<region>.pooler.supabase.com` | `5432` | `rolename.<ref>` |
| **Transaction-mode pooler** | `aws-0-<region>.pooler.supabase.com` | `6543` | `rolename.<ref>` |

### Which type to use for each pool

The application uses `postgres.js` which enables **named prepared statements by default**. Supabase's transaction-mode pooler (port 6543) does not support prepared statements and will error.

| Environment variable | Role | Recommended connection type | Why |
|---------------------|------|-----------------------------|-----|
| `DATABASE_URL` | `lead_svc` (app_user) | Direct or Session-mode pooler | Either works; session pooler saves connections on Pro plan |
| `DATABASE_URL_TENANT` | `tenant_dash_svc` (tenant_admin) | Direct or Session-mode pooler | Low traffic — direct is fine |
| `DATABASE_URL_SERVICE` | `crm_svc` (BYPASSRLS) | **Direct only** | `withServiceTx` uses raw `tx.unsafe()` with postgres.js prepared statement infrastructure; must bypass PgBouncer |
| `DATABASE_URL_ANALYTICS` | `analytics_svc` (BYPASSRLS SELECT) | Direct or Session-mode pooler | Read-only; direct is fine |

> **Rule:** Never point any of the four pools at the **transaction-mode pooler (port 6543)** without first adding `prepare: false` to `buildPoolOptions()` in `src/lib/db/pool-factory.ts`. The simplest and safest default is to use direct connections for all four.

### Direct connection string format

```
postgresql://ROLE:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres
```

Example values for each variable (replace `abcxyzproject` with your project ref):

```
DATABASE_URL=postgresql://lead_svc:LEAD_SVC_PASSWORD@db.abcxyzproject.supabase.co:5432/postgres
DATABASE_URL_TENANT=postgresql://tenant_dash_svc:TENANT_DASH_PASSWORD@db.abcxyzproject.supabase.co:5432/postgres
DATABASE_URL_SERVICE=postgresql://crm_svc:CRM_SVC_PASSWORD@db.abcxyzproject.supabase.co:5432/postgres
DATABASE_URL_ANALYTICS=postgresql://analytics_svc:ANALYTICS_SVC_PASSWORD@db.abcxyzproject.supabase.co:5432/postgres
```

Find your project ref in **Supabase Dashboard → Project Settings → General → Reference ID**.

### SSL

SSL is handled automatically. `pool-factory.ts` enables `ssl: "require"` whenever `NODE_ENV === "production"`, which Vercel sets automatically. No `?sslmode=require` suffix is needed in the connection strings, and no `DB_SSL_CA` variable is required for Supabase (its certificate is signed by a trusted CA).

---

## Step 5 — Configure Vercel Environment Variables

In your Vercel project: **Settings → Environment Variables → Add**. Set all variables for the **Production** environment.

```
DATABASE_URL          = postgresql://lead_svc:...@db.<ref>.supabase.co:5432/postgres
DATABASE_URL_TENANT   = postgresql://tenant_dash_svc:...@db.<ref>.supabase.co:5432/postgres
DATABASE_URL_SERVICE  = postgresql://crm_svc:...@db.<ref>.supabase.co:5432/postgres
DATABASE_URL_ANALYTICS = postgresql://analytics_svc:...@db.<ref>.supabase.co:5432/postgres

PG_MAX                = 5
PG_IDLE_TIMEOUT       = 30

JWT_SECRET            = <generate: openssl rand -base64 48>
BCRYPT_ROUNDS         = 12

NEXT_PUBLIC_APP_URL   = https://your-project.vercel.app
CRON_SECRET           = <generate: openssl rand -base64 32>
```

### `PG_MAX` on Supabase free tier

The Supabase free tier allows **60 direct connections** total per project. With 4 pools × 5 max connections each = 20 connections from your app. Keep `PG_MAX=5` on free tier. Raise to `PG_MAX=10` on the Pro plan (200 connections).

### Cron job (`vercel.json`)

The `vercel.json` already defines the cron schedule:

```json
{
  "crons": [
    {
      "path": "/api/cron/mark-missed-followups",
      "schedule": "*/15 * * * *"
    }
  ]
}
```

The cron endpoint authenticates using `CRON_SECRET`. The route reads the `x-cron-secret` request header and compares it against the env var. Add `CRON_SECRET` to Vercel environment variables so you can call the endpoint manually or trigger it from any scheduler.

---

## Step 6 — Deploy to Vercel

```bash
# Link the project (one-time setup)
vercel link

# Deploy to production
vercel --prod
```

Or connect your Git repository in the Vercel dashboard for automatic deployments on push.

---

## Step 7 — Seed the First Admin User

The seed script requires an existing organisation. After the migrations run, the sample data in `09_seed_data.sql` already includes organisations. Find an organisation UUID from Supabase SQL Editor:

```sql
SELECT id, name FROM organizations LIMIT 10;
```

Then run the seed script locally, pointing at Supabase:

```bash
# Create .env.local with Supabase credentials
cat > .env.local <<'EOF'
DATABASE_URL=postgresql://lead_svc:PASSWORD@db.REF.supabase.co:5432/postgres
DATABASE_URL_TENANT=postgresql://tenant_dash_svc:PASSWORD@db.REF.supabase.co:5432/postgres
DATABASE_URL_SERVICE=postgresql://crm_svc:PASSWORD@db.REF.supabase.co:5432/postgres
DATABASE_URL_ANALYTICS=postgresql://analytics_svc:PASSWORD@db.REF.supabase.co:5432/postgres
JWT_SECRET=your_jwt_secret
BCRYPT_ROUNDS=12
SEED_ORG_ID=<uuid-from-query-above>
SEED_ADMIN_EMAIL=admin@yourcompany.com
SEED_ADMIN_PASSWORD=StrongPassword@123
SEED_ADMIN_NAME=FitClass Admin
EOF

npm run db:seed-admin
```

> If you already ran `09_seed_data.sql`, test users already exist. The seed script is only needed to create your own admin account outside the sample data.

---

## Step 8 — Post-Deployment Verification

### 1. Test login

```bash
curl -X POST https://your-project.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"root.user@root.com","password":"Admin@1234"}'
```

Expected: `200 OK` with a `token` field in the JSON response.

### 2. Test authenticated route

```bash
curl https://your-project.vercel.app/api/leads \
  -H "Authorization: Bearer <token-from-login>"
```

Expected: `200 OK` with lead data, or `200` with an empty array if the org has no leads.

### 3. Test cron endpoint

```bash
curl https://your-project.vercel.app/api/cron/mark-missed-followups \
  -H "x-cron-secret: <CRON_SECRET>"
```

Expected: `200 OK` with a count of updated follow-ups.

### 4. Verify connection count in Supabase

In Supabase Dashboard → **Reports → Database → Connections** — you should see ≤ `4 × PG_MAX` connections from your Vercel deployment.

---

## Troubleshooting

### `prepared statement "s1" already exists`

Cause: A connection was recycled through transaction-mode PgBouncer (port 6543) while postgres.js had a cached prepared statement.

Fix: Switch all `DATABASE_URL_*` values to the direct host (`db.<ref>.supabase.co:5432`) or the session-mode pooler (`aws-0-<region>.pooler.supabase.com:5432`). Do not use port 6543.

### `SSL connection required`

Cause: `NODE_ENV` is not set to `production`, so `pool-factory.ts` sets `ssl: false`.

Fix: Ensure `NODE_ENV=production` is set in Vercel environment variables. Vercel sets this automatically for deployments; it should not need to be added manually. If testing locally against Supabase, add `?sslmode=require` to the connection string or temporarily set `NODE_ENV=production` in `.env.local`.

### `password authentication failed for user "crm_svc"`

Cause: The `crm_svc` role either was not created, or the password in `DATABASE_URL_SERVICE` doesn't match what was set in `CREATE ROLE`.

Fix: Verify the role exists and reset its password in the Supabase SQL Editor:
```sql
-- Check it exists:
SELECT rolname, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'crm_svc';

-- Reset password if needed:
ALTER ROLE crm_svc WITH PASSWORD 'new_strong_password';
```
Then update `DATABASE_URL_SERVICE` in Vercel to match.

### `relation "assignments" does not exist`

Cause: Old query code referencing the removed `assignments` table. All assignment operations now target `marketing_leads.assigned_user_id`.

Fix: This should not occur after the Supabase refactor. If it does, search for any remaining references to the `assignments` table in the codebase.

### `permission denied for table <name>`

Cause: A service role is attempting an operation not covered by its grants.

Fix: Check `08_grants.sql` for the expected grants. If a table was added after running `08_grants.sql`, re-run `08_grants.sql` or manually `GRANT` the missing permission.

### `current_setting('app.current_org_id') is not set`

Cause: A query is running outside a `withOrgTx` / `withTenantTx` transaction wrapper, directly against a connection that uses the `app_user` or `tenant_admin` role. The RLS policies require these session variables.

Fix: All database calls must go through `withOrgTx`, `withTenantTx`, or `withServiceTx` from `src/lib/db/transaction.ts`. Direct pool queries (`sql\`...\``) bypass the session variable setup.

### Cron job not firing

Cause: `vercel.json` cron schedules are only active in the Production deployment. Preview deployments do not run crons.

Fix: Verify the deployment is the Production deployment (not a preview). Check **Vercel Dashboard → Project → Cron Jobs** to see the schedule and last execution.

---

## Environment Variable Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | `lead_svc` login — single-org CRM operations |
| `DATABASE_URL_TENANT` | Yes | `tenant_dash_svc` login — cross-org tenant reporting |
| `DATABASE_URL_SERVICE` | Yes | `crm_svc` login — custom BYPASSRLS role (replaces Supabase's built-in `service_role`). Direct connection only. |
| `DATABASE_URL_ANALYTICS` | Yes | `analytics_svc` login — read-only BYPASSRLS for analytics |
| `PG_MAX` | No | Max connections per pool (default: 10; use 5 on Supabase free tier) |
| `PG_IDLE_TIMEOUT` | No | Idle connection timeout in seconds (default: 30) |
| `JWT_SECRET` | Yes | Signs and verifies session JWTs. Min 48 chars. |
| `BCRYPT_ROUNDS` | No | bcrypt cost factor (default: 10; use 12 in production) |
| `NEXT_PUBLIC_APP_URL` | Yes | Public URL of the deployed app (no trailing slash) |
| `CRON_SECRET` | Yes | Bearer token the cron endpoint validates against |
| `DB_SSL_CA` | No | Path to custom CA PEM file. Not needed for Supabase. |
| `SEED_ORG_ID` | Seed only | UUID of an existing org; used only when running `npm run db:seed-admin` |
| `SEED_ADMIN_EMAIL` | Seed only | Email for the seeded admin account |
| `SEED_ADMIN_PASSWORD` | Seed only | Plaintext password for the seeded admin account |
| `SEED_ADMIN_NAME` | Seed only | Display name for the seeded admin account |

---

## Deployment Checklist

- [ ] Supabase project created; project reference ID noted
- [ ] In `01_roles.sql`: `service_role` block commented out before running
- [ ] All 12 SQL files executed in order via the SQL Editor, no errors
- [ ] `crm_svc` role created with BYPASSRLS after `08_grants.sql` (see Step 2)
- [ ] All 7 service login role passwords rotated from `replace_in_env`
- [ ] Connection strings tested locally against Supabase (with `NODE_ENV=production` or `?sslmode=require`)
- [ ] All required environment variables set in Vercel (Production environment)
- [ ] `vercel --prod` deployment completed without build errors
- [ ] Login endpoint returns JWT (`POST /api/auth/login`)
- [ ] Dashboard loads and shows lead data (`GET /dashboard/leads`)
- [ ] Cron endpoint returns 200 (`GET /api/cron/mark-missed-followups`)
- [ ] Supabase connection count ≤ 4 × PG_MAX
- [ ] Admin account seeded (if not using sample data from `09_seed_data.sql`)
