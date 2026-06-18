# Local Development Setup (Docker PostgreSQL)

This guide gets the full stack running on your laptop using Docker for PostgreSQL.
No external services required — everything runs locally.

---

## Prerequisites

- Docker Desktop (running)
- Node.js 20+
- PowerShell (Windows)

---

## Step 1 — Run the setup script

Run from the **project root**. This handles everything database-related in one go:

```powershell
.\deploy-db.ps1
```

What it does:

1. `npm install` — installs dependencies (needed before bcrypt step)
2. Starts the `crm-postgres` Docker container (creates it if absent, starts it if stopped)
3. Waits for Postgres to accept connections
4. Deploys all schema scripts from `databse-model/` in order
5. Sets service role passwords to `devpass`
6. Bcrypt-hashes `Admin@12345` and sets it on all seeded demo users

Re-running is safe — the container check is idempotent and schema scripts use `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` guards.

---

## Step 2 — Create `.env.local`

Create `.env.local` in the project root with this content:

```dotenv
DATABASE_URL=postgres://lead_svc:devpass@localhost:5433/crm
DATABASE_URL_TENANT=postgres://tenant_dash_svc:devpass@localhost:5433/crm
DATABASE_URL_SERVICE=postgres://crm_service:devpass@localhost:5433/crm
DATABASE_URL_ANALYTICS=postgres://analytics_svc:devpass@localhost:5433/crm

PG_MAX=10
PG_IDLE_TIMEOUT=30

# Any long string is fine for local dev
JWT_SECRET=dev-jwt-secret-at-least-48-chars-long-padded-here-ok

# Use 10 rounds locally (faster); use 12 in production
BCRYPT_ROUNDS=10

NEXT_PUBLIC_APP_URL=http://localhost:3000

CRON_SECRET=dev-cron-secret
```

---

## Step 3 — Start the app

```powershell
npm run dev
```

Open http://localhost:3000 — it redirects to `/login`.

---

## Login credentials

All users below have password **`Admin@12345`** after the setup script.

| Email                       | Role                 | Org                            |
| --------------------------- | -------------------- | ------------------------------ |
| `vikram.malhotra@apexcp.in` | org_admin            | FitClass – Connaught Place     |
| `priya.kapoor@apexcp.in`    | sales_representative | FitClass – Connaught Place     |
| `rahul.singh@apexcp.in`     | sales_representative | FitClass – Connaught Place     |
| `ananya.verma@apexskt.in`   | org_admin            | FitClass – Saket               |
| `rajan.mehta@velvetkm.in`   | org_admin            | Velvet Boutique – Khan Market  |
| `deepa.nair@velvetln.in`    | org_admin            | Velvet Boutique – Lajpat Nagar |

**Start with `vikram.malhotra@apexcp.in`** — this org has the richest seed data.

---

## What the seed data looks like

### FitClass – Connaught Place (login as Vikram Malhotra)

**Leads (9):**

| Lead            | Status    | Assigned to  |
| --------------- | --------- | ------------ |
| Riya Sharma     | new       | unassigned   |
| Arjun Mehta     | contacted | Priya Kapoor |
| Sunita Rao      | qualified | Rahul Singh  |
| Devesh Kumar    | converted | Priya Kapoor |
| Kavya Nair      | failed    | Rahul Singh  |
| Manish Tripathi | on_hold   | unassigned   |
| Priti Sharma    | nurturing | Priya Kapoor |
| Vikash Gupta    | new       | unassigned   |
| Ananya Singh    | contacted | Rahul Singh  |

**Campaigns (2):**

- `FitClass Transformation – FB Q2` — Facebook, active, ₹45,000 budget
- `FitClass CP Google Search Branded` — Google, paused, ₹18,000 budget

**Interactions:** pre-seeded for the contacted/qualified/converted leads (call logs,
WhatsApp notes, in-person visit records).

**Follow-up pipeline (`/dashboard/follow-ups`):** follow-ups are created via the UI
when you change a lead's status to one with `requires_followup = true` (contacted,
qualified, on_hold, nurturing). The seed data does not pre-populate `lead_follow_ups`
rows — use the status dropdown on any lead to create the first ones.

### Other orgs (same pattern, 9 leads each)

- **Apex Iron Gym – Saket**: login as `ananya.verma@apexskt.in`
- **Velvet Boutique – Khan Market**: login as `rajan.mehta@velvetkm.in`
- **Velvet Boutique – Lajpat Nagar**: login as `deepa.nair@velvetln.in`

---

## Useful dev commands

```powershell
# Stop container (data is preserved in the Docker volume)
docker stop crm-postgres

# Start it again next session (or just re-run .\deploy-db.ps1)
docker start crm-postgres

# Wipe everything and start completely fresh
docker rm -f crm-postgres
.\deploy-db.ps1

# Open an interactive psql shell
docker exec -it crm-postgres psql -U sa -d crm

# List all tables
docker exec crm-postgres psql -U sa -d crm -c "\dt"

# List all roles
docker exec crm-postgres psql -U sa -d crm -c "\du"

# Check lead counts per org
docker exec crm-postgres psql -U sa -d crm -c "
SELECT o.name AS org, COUNT(l.id) AS leads
FROM marketing_leads l
JOIN organizations o ON o.id = l.org_id
WHERE NOT l.is_deleted
GROUP BY o.name ORDER BY o.name;
"

# Manually trigger the missed-followups cron
curl -H "x-cron-secret: dev-cron-secret" http://localhost:3000/api/cron/mark-missed-followups
```

---

## Troubleshooting

**`password authentication failed for user "lead_svc"`**
Step 5 of the setup script did not complete. Re-run `.\deploy-db.ps1`.

**`relation "marketing_leads" does not exist`**
A core migration failed. Wipe and re-run:

```powershell
docker rm -f crm-postgres
.\deploy-db.ps1
```

**Login returns "Invalid credentials"**
`password_hash` is still NULL. Re-run `.\deploy-db.ps1`, then confirm:

```powershell
docker exec crm-postgres psql -U sa -d crm -c "
SELECT email, password_hash IS NOT NULL AS has_pw
FROM users WHERE email = 'vikram.malhotra@apexcp.in';
"
```

Should show `has_pw = t`.

**App starts but `/api/leads` returns 401**
`JWT_SECRET` may be missing or empty in `.env.local`. Check step 2.
