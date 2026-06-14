# Enterprise Monorepo Architecture

## Overview

A monorepo where each service is independently deployable, shares a common type library, and is orchestrated by a root workspace. The backend exposes a RESTful API; the frontend is a standalone React/Next.js app that calls it.

```
fitclass-crm/                          ← root workspace (nx or turborepo)
├── package.json                       ← workspace root; declares all workspaces
├── turbo.json                         ← build pipeline graph (lint→test→build→deploy)
├── tsconfig.base.json                 ← shared compiler options, path aliases
├── .env.example                       ← template for all env vars across services
├── docker-compose.yml                 ← local dev: postgres + pgbouncer + services
├── Makefile                           ← top-level dev commands (make dev, make test)
│
├── packages/                          ← shared libraries (no app code)
│   ├── types/                         ← canonical TypeScript types shared by all services
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── auth.ts                ← SessionUser, JwtPayload, UserRole (from ROLES tuple)
│   │   │   ├── database.ts            ← DatabaseUser, Assignment, Activity DB row shapes
│   │   │   ├── api.ts                 ← shared request/response envelope types
│   │   │   └── index.ts               ← barrel re-export
│   │   └── tsconfig.json
│   │
│   ├── auth-constants/                ← RBAC constants (Edge-safe, no Node APIs)
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── roles.ts               ← ROLES tuple, ROLE_RANK, ROLE_LABELS, ROLE_TIERS
│   │   │   ├── jwt.ts                 ← JWT_EXPIRES_IN, AUTH_COOKIE_NAME, JWT_ISSUER
│   │   │   └── index.ts
│   │   └── tsconfig.json
│   │
│   ├── permissions/                   ← pure RBAC predicates (sync, no I/O)
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── ranks.ts               ← RANKS constant (rank thresholds from user_roles)
│   │   │   ├── index.ts               ← canCreateUser, canViewUser, canManageUsers, etc.
│   │   │   ├── assignments.ts         ← canViewLead, canAssignLead, canAssignToUser
│   │   │   ├── leads.ts               ← canViewLeadData, canEditLead, canAssignLead
│   │   │   └── scope.ts               ← resolveActorOrgIds (server-only, uses DB)
│   │   └── tsconfig.json
│   │
│   ├── db/                            ← database client and query utilities
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── client.ts              ← postgres.js pool factories (app, tenant, service)
│   │   │   ├── transaction.ts         ← withOrgTx, withTenantTx, withServiceTx helpers
│   │   │   ├── errors.ts              ← DatabaseError, fromPgError, AppError mapping
│   │   │   └── index.ts
│   │   └── tsconfig.json
│   │
│   └── validation/                    ← zod schemas shared across services
│       ├── package.json
│       ├── src/
│       │   ├── auth.ts                ← loginSchema, changePasswordSchema
│       │   ├── users.ts               ← createUserSchema, updateUserSchema
│       │   ├── assignments.ts         ← createAssignmentSchema, updateAssignmentSchema
│       │   └── index.ts
│       └── tsconfig.json
│
├── services/                          ← independently deployable backend services
│   │
│   ├── api-gateway/                   ← thin gateway / BFF for the web frontend (optional)
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   ├── src/
│   │   │   ├── server.ts              ← Express/Fastify entry; mounts all routers
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts            ← JWT validation middleware (req.user injection)
│   │   │   │   ├── cors.ts            ← CORS policy (web frontend origin only)
│   │   │   │   └── error-handler.ts   ← maps AppError → HTTP status codes
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts            ← POST /auth/login, POST /auth/logout, GET /auth/me
│   │   │   │   ├── users.ts           ← CRUD /users, PATCH /users/:id/role, POST /users/:id/reset-password
│   │   │   │   ├── leads.ts           ← GET /leads, PATCH /leads/:id (status, assignment)
│   │   │   │   ├── assignments.ts     ← POST/PATCH/DELETE /assignments, GET /assignments
│   │   │   │   ├── branches.ts        ← GET /branches, GET /branches/all
│   │   │   │   ├── lookups.ts         ← GET /lookups/lead-stages, GET /lookups/lead-sources
│   │   │   │   ├── locations.ts       ← GET /locations (country/state/city cascade)
│   │   │   │   ├── analytics.ts       ← GET /analytics/pipeline, GET /analytics/conversions
│   │   │   │   ├── activities.ts      ← GET /activities (audit log, admin only)
│   │   │   │   └── cron.ts            ← POST /cron/followup-digest (secret-gated)
│   │   │   └── lib/
│   │   │       ├── session.ts         ← reads cookie, verifies JWT, revalidates from DB
│   │   │       └── route-handler.ts   ← withRoute HOF: auth gate + AppError → JSON
│   │   └── tsconfig.json
│   │
│   ├── auth-service/                  ← isolated JWT mint/verify; optional separate deploy
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   ├── src/
│   │   │   ├── server.ts              ← entry point
│   │   │   ├── jwt.ts                 ← signJwt, verifyJwt (Node runtime)
│   │   │   ├── jwt-edge.ts            ← Edge-safe verifier (jose, no Node crypto)
│   │   │   ├── password.ts            ← bcrypt hash + compare wrappers
│   │   │   ├── cookies.ts             ← sessionCookieFor helper (SameSite, HttpOnly, Secure)
│   │   │   ├── db-user.ts             ← getUserByEmail, getUserById, updateLastLogin
│   │   │   └── provider.ts            ← single execution path; delegates to db-user
│   │   └── tsconfig.json
│   │
│   ├── leads-service/                 ← lead CRUD, status transitions, campaign management
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   ├── src/
│   │   │   ├── server.ts              ← entry point
│   │   │   ├── routes/
│   │   │   │   ├── leads.ts           ← GET/PATCH /leads; filters by org + role scope
│   │   │   │   ├── campaigns.ts       ← CRUD /campaigns (ad campaigns per org)
│   │   │   │   └── follow-ups.ts      ← GET/POST /follow-ups; overdue lead tracking
│   │   │   ├── queries/
│   │   │   │   ├── leads.ts           ← listLeads(orgIds, filters), getLeadById
│   │   │   │   └── campaigns.ts       ← listCampaigns, createCampaign, updateCampaign
│   │   │   ├── mutations/
│   │   │   │   ├── leads.ts           ← updateLeadStatus, bulkImportLeads
│   │   │   │   └── follow-ups.ts      ← createFollowUp, resolveFollowUp
│   │   │   └── serializers/
│   │   │       └── leads.ts           ← toLeadView (strips internal columns)
│   │   └── tsconfig.json
│   │
│   ├── users-service/                 ← user CRUD, role management, hierarchy
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   ├── src/
│   │   │   ├── server.ts              ← entry point
│   │   │   ├── routes/
│   │   │   │   ├── users.ts           ← GET/POST/PATCH /users with RBAC hierarchy checks
│   │   │   │   └── reset-password.ts  ← POST /users/:id/reset-password (org_admin only)
│   │   │   ├── queries/
│   │   │   │   └── users.ts           ← listUsers(orgIds), getUserById, countActiveAdmins
│   │   │   ├── mutations/
│   │   │   │   └── users.ts           ← createUser, updateUser, setUserActive
│   │   │   └── serializers/
│   │   │       └── users.ts           ← toSessionUser (strips password_hash)
│   │   └── tsconfig.json
│   │
│   ├── assignments-service/           ← lead assignment routing and history
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   ├── src/
│   │   │   ├── server.ts              ← entry point
│   │   │   ├── routes/
│   │   │   │   └── assignments.ts     ← POST/PATCH/DELETE /assignments with role matrix
│   │   │   ├── queries/
│   │   │   │   └── assignments.ts     ← getAssignmentById, listAllAssignments(orgIds)
│   │   │   ├── mutations/
│   │   │   │   └── assignments.ts     ← assignLead, reassignLead, unassignLead
│   │   │   └── serializers/
│   │   │       └── assignments.ts     ← toAssignmentView (includes assignee name via JOIN)
│   │   └── tsconfig.json
│   │
│   ├── activities-service/            ← append-only audit log (write and query)
│   │   ├── package.json
│   │   ├── Dockerfile
│   │   ├── src/
│   │   │   ├── server.ts              ← entry point
│   │   │   ├── routes/
│   │   │   │   └── activities.ts      ← GET /activities (admin-scoped audit viewer)
│   │   │   ├── mutations/
│   │   │   │   └── activities.ts      ← logLoginSuccess, logUserCreated, logPrivilegeDenied, etc.
│   │   │   └── types.ts               ← ActivityAction union (login_success | user_created | ...)
│   │   └── tsconfig.json
│   │
│   └── analytics-service/             ← reporting and pipeline metrics
│       ├── package.json
│       ├── Dockerfile
│       ├── src/
│       │   ├── server.ts              ← entry point (analytics_svc DB role, read-only)
│       │   ├── routes/
│       │   │   ├── pipeline.ts        ← GET /pipeline — lead counts by stage per org
│       │   │   ├── conversions.ts     ← GET /conversions — funnel metrics per period
│       │   │   └── team.ts            ← GET /team — per-user lead load and conversion rate
│       │   └── queries/
│       │       └── analytics.ts       ← all read-only analytical queries (analytics_svc pool)
│       └── tsconfig.json
│
├── apps/                              ← user-facing applications
│   │
│   └── web/                           ← Next.js 16 App Router frontend (React 19)
│       ├── package.json
│       ├── next.config.ts             ← rewrites API calls to backend services
│       ├── tsconfig.json
│       ├── tailwind.config.ts         ← design tokens and plugin config
│       ├── middleware.ts              ← Edge auth gate — validates JWT, protects routes
│       ├── app/
│       │   ├── layout.tsx             ← root layout (fonts, metadata, theme provider)
│       │   ├── page.tsx               ← root redirect (→ /dashboard/leads or /login)
│       │   ├── login/
│       │   │   └── page.tsx           ← login form; POSTs to /api/auth/login proxy
│       │   └── dashboard/
│       │       ├── layout.tsx         ← auth shell: sidebar nav + user menu
│       │       ├── leads/
│       │       │   └── page.tsx       ← leads view (server-fetches, passes to LeadDashboardShell)
│       │       ├── assignments/
│       │       │   └── page.tsx       ← assignments management surface
│       │       ├── users/
│       │       │   └── page.tsx       ← user management (senior_sales_executive+)
│       │       ├── analytics/
│       │       │   └── page.tsx       ← analytics dashboard (org_admin+)
│       │       ├── my-leads/
│       │       │   └── page.tsx       ← personal lead queue (sales tier)
│       │       └── team/
│       │           └── page.tsx       ← team roster placeholder
│       ├── components/
│       │   ├── dashboard/
│       │   │   ├── LeadDashboardShell.tsx   ← main leads surface with filters + grid
│       │   │   ├── LocationFilters.tsx      ← country/state/city/branch cascade dropdowns
│       │   │   ├── RoleBadge.tsx            ← role chip (color-coded by tier)
│       │   │   ├── Protected.tsx            ← UX-only role-gated wrapper (no security)
│       │   │   ├── StatsCards.tsx           ← summary count cards (new/converted/unassigned)
│       │   │   └── Placeholder.tsx          ← "coming soon" page template
│       │   ├── assignments/
│       │   │   └── InlineAssignmentSelector.tsx  ← portaled picker for row-level assignment
│       │   ├── users/
│       │   │   ├── UsersClient.tsx          ← modal state orchestrator + refresh trigger
│       │   │   ├── UsersTable.tsx           ← searchable/filterable user list
│       │   │   ├── RoleSelector.tsx         ← role <select> filtered by actor's rank
│       │   │   ├── CreateUserModal.tsx      ← create user form with role + manager picker
│       │   │   ├── EditUserModal.tsx        ← edit user form with hierarchy-aware role picker
│       │   │   ├── UserStatusBadge.tsx      ← active/inactive pill chip
│       │   │   ├── Modal.tsx                ← focus-trapped accessible modal shell
│       │   │   └── TemporaryPasswordPanel.tsx ← post-create password display + copy button
│       │   ├── LeadsTable.tsx               ← AG Grid leads table with inline assign column
│       │   └── common/
│       │       └── DownloadButton.tsx        ← CSV/Excel export trigger
│       ├── hooks/
│       │   ├── useLeads.ts            ← SWR-based lead list fetch with revalidation
│       │   ├── useBranches.ts         ← org branch list; auto-selects first on load
│       │   ├── useAllBranches.ts      ← full cross-org branch list (for admin pickers)
│       │   ├── useLocationFilters.ts  ← cascading location filter state machine
│       │   ├── useLeadSources.ts      ← lead source options for filter dropdowns
│       │   └── useDropdown.ts         ← useDismissible + useDropdown click-outside hooks
│       └── src/
│           ├── config/
│           │   └── navigation.ts      ← DASHBOARD_NAV items; navItemsForRole(role) helper
│           ├── lib/
│           │   ├── api/
│           │   │   └── client.ts      ← typed fetch wrappers for each backend service
│           │   ├── export/
│           │   │   ├── export.ts      ← generic CSV/Excel export (exportRows, buildFilename)
│           │   │   └── lead-columns.ts ← lead-specific export column definitions
│           │   ├── leads/
│           │   │   └── filter.ts      ← applyLeadFilter (client-side stat-card filter)
│           │   └── validations/
│           │       └── auth.ts        ← loginSchema (zod, client-side pre-validation)
│           └── types/
│               └── index.ts           ← re-exports from @crm/types for web imports
│
├── databse-model/                     ← PostgreSQL schema (source of truth; run once per env)
│   ├── 00_extensions.sql              ← pgcrypto, pg_trgm, uuid-ossp
│   ├── 01_roles.sql                   ← DB roles: app_user, tenant_admin, service_role
│   ├── 02_lookup_tables.sql           ← user_roles, lead_stages, marketing_platforms
│   ├── 03_core_tables.sql             ← tenants, organizations, users, marketing_leads
│   ├── 04_rls_policies.sql            ← Row Level Security policies per role
│   ├── 05_indexes.sql                 ← performance indexes (org_id, role_id, email)
│   ├── 06_audit_triggers.sql          ← updated_at auto-bump triggers
│   ├── 07_views.sql                   ← lead_with_assignment, user_with_role views
│   ├── 08_grants.sql                  ← GRANT statements per DB role
│   ├── 09_seed_data.sql               ← initial lookup values (stages, platforms, roles)
│   ├── 10_user_hierarchy.sql          ← manager adjacency-list helpers
│   └── 11_service_logins.sql          ← CREATE ROLE for each service pool user
│
├── scripts/                           ← operational one-off scripts
│   ├── seed-admin.ts                  ← bootstrap first org_admin (requires SEED_ORG_ID)
│   └── migrate.ts                     ← ordered SQL runner for databse-model/ files
│
├── infra/                             ← infrastructure as code
│   ├── docker/
│   │   ├── postgres/
│   │   │   └── init.sql               ← Docker init SQL (runs databse-model/ on first start)
│   │   └── pgbouncer/
│   │       └── pgbouncer.ini          ← connection pooler config (transaction mode)
│   └── k8s/                           ← Kubernetes manifests (one Deployment per service)
│       ├── api-gateway/
│       │   ├── deployment.yaml        ← replicas, image, resource limits
│       │   ├── service.yaml           ← ClusterIP service
│       │   └── hpa.yaml               ← HorizontalPodAutoscaler (CPU-based)
│       ├── web/
│       │   ├── deployment.yaml
│       │   ├── service.yaml
│       │   └── ingress.yaml           ← Ingress with TLS + /api/* → api-gateway rewrite
│       ├── leads-service/
│       │   ├── deployment.yaml
│       │   └── service.yaml
│       ├── users-service/
│       │   ├── deployment.yaml
│       │   └── service.yaml
│       ├── assignments-service/
│       │   ├── deployment.yaml
│       │   └── service.yaml
│       ├── activities-service/
│       │   ├── deployment.yaml
│       │   └── service.yaml
│       └── analytics-service/
│           ├── deployment.yaml
│           └── service.yaml
│
└── .github/
    └── workflows/
        ├── ci.yml                     ← lint + typecheck + test on every PR
        ├── build-and-push.yml         ← Docker build + ECR push on merge to main
        └── deploy.yml                 ← kubectl rollout per changed service (path-filter)
```

---

## Service Communication

```
Browser
  │  HTTPS
  ▼
apps/web  (Next.js — port 3000)
  │  rewrites /api/* → api-gateway
  │  middleware.ts validates JWT at Edge before any request hits React
  ▼
services/api-gateway  (port 4000)
  │  validates JWT, injects req.user, routes to internal services
  │  ├── /auth/*          → auth-service (port 4001)
  │  ├── /leads/*         → leads-service (port 4002)
  │  ├── /users/*         → users-service (port 4003)
  │  ├── /assignments/*   → assignments-service (port 4004)
  │  ├── /activities/*    → activities-service (port 4005)
  │  └── /analytics/*     → analytics-service (port 4006)
  ▼
PostgreSQL 15  (via PgBouncer, transaction mode)
  three connection pools:
    app_user       — RLS on (org-scoped reads)
    tenant_admin   — cross-org queries within a tenant
    service_role   — BYPASSRLS (writes, admin ops)
    analytics_svc  — read-only views (analytics-service only)
```

---

## Key Architectural Decisions

| Decision | Rationale |
|---|---|
| Monorepo with `packages/` | Types and permissions are shared; duplicating them would cause drift |
| Gateway pattern | One ingress point for auth; downstream services trust the injected `req.user` |
| Service per domain | Leads, Users, Assignments, Activities can scale independently |
| `packages/db` shared | All services use the same postgres.js pool factory and transaction helpers |
| `packages/permissions` shared | Same `canViewUser`, `canAssignToUser` predicates run in gateway AND in each service — defense in depth |
| Separate analytics_svc pool | Read-only DB role; analytics queries cannot accidentally write |
| PgBouncer transaction mode | Enables `SET LOCAL` GUCs for per-request org/user context injection (multi-tenant RLS) |
| JWT watermark (`pwd_iat`) | Password changes immediately invalidate all existing tokens without a revocation list |

---

## Migration from Current Codebase

The current `fitclass_dashboard_with_db` (Next.js full-stack) maps to this monorepo as follows:

| Current | Monorepo target |
|---|---|
| `app/api/auth/*` | `services/auth-service/` + `services/api-gateway/routes/auth.ts` |
| `app/api/users/*` | `services/users-service/` |
| `app/api/leads/*` | `services/leads-service/` |
| `app/api/assignments/*` | `services/assignments-service/` |
| `app/api/activities/*` | `services/activities-service/` |
| `app/dashboard/*` | `apps/web/app/dashboard/*` |
| `src/features/*/queries.ts` | `services/*/queries/` |
| `src/features/*/mutations.ts` | `services/*/mutations/` |
| `src/features/*/serializers.ts` | `services/*/serializers/` |
| `src/lib/permissions/` | `packages/permissions/` |
| `src/lib/db/` | `packages/db/` |
| `src/types/` | `packages/types/` |
| `src/features/auth/constants.ts` | `packages/auth-constants/` |
| `databse-model/` | `databse-model/` (unchanged) |
