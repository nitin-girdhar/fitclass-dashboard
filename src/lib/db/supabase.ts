/**
 * Server-side Supabase admin client (singleton).
 *
 * SERVER-ONLY. Uses the SERVICE ROLE key, which bypasses every Row Level
 * Security policy and has unrestricted read/write to the entire database.
 * It must NEVER reach the browser bundle:
 *  - it is not prefixed with NEXT_PUBLIC_
 *  - it is only ever imported from server code (route handlers, server
 *    actions, server components) — never from `'use client'` files
 *  - a runtime guard below throws if this module is somehow evaluated in a
 *    browser context (defence in depth)
 *
 * Singleton rationale: `createClient` is cheap but Next.js can re-evaluate
 * modules per request in dev/HMR. Memoising on `globalThis` keeps a single
 * client across hot reloads and avoids leaking connections/listeners.
 *
 * Future scalability:
 *  - When DB tables land, generate types with `supabase gen types typescript`
 *    and parameterise `createClient<Database>` for end-to-end type safety.
 *  - A separate request-scoped anon/SSR client (cookie-aware) can be added
 *    alongside this admin client without changing call sites.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { WebSocket as WsWebSocket } from 'ws';
import { getServerEnv } from '@/src/lib/auth/env';

/**
 * ── Node.js 20 WebSocket compatibility ──────────────────────────────────────
 * `createClient` always constructs an internal RealtimeClient, EVEN IF we
 * never open a channel — realtime is initialised eagerly as part of the
 * client, not lazily on first subscribe. That RealtimeClient resolves a
 * WebSocket constructor at init time.
 *
 * The browser and Node.js 22+ expose a GLOBAL `WebSocket`. Node.js 20 does
 * NOT — there is no `globalThis.WebSocket` — so supabase-realtime throws
 * "Node.js 20 detected without native WebSocket support" the moment the
 * client (and therefore the seed script / any server route) initialises.
 *
 * Fix: inject the `ws` package as the realtime transport. `ws` is a pure
 * Node module and is only reachable here, which is SERVER-ONLY (guarded
 * below + service-role key + never imported by client/edge code), so it
 * never reaches the browser bundle or the Edge middleware. The browser keeps
 * using its native global WebSocket; this override only matters in Node.
 *
 * `ws`'s WebSocket is API-compatible with Supabase's minimal
 * `WebSocketLikeConstructor` but its TS types are not structurally identical
 * (different event/`send` typings), so we bridge with a single explicit cast
 * here rather than leaking `any` into the codebase.
 */
import type { SupabaseClientOptions } from '@supabase/supabase-js';

// Derive the exact transport type from the public options (RealtimeClientOptions
// itself is not a named export of supabase-js).
type RealtimeTransport = NonNullable<
  NonNullable<SupabaseClientOptions<string>['realtime']>['transport']
>;

const wsTransport = WsWebSocket as unknown as RealtimeTransport;

if (typeof window !== 'undefined') {
  throw new Error(
    '[supabase] supabaseAdmin was imported in a browser context. ' +
      'This client uses the service role key and is server-only.',
  );
}

// Memoise across dev hot-reloads without polluting the public global type.
const globalForSupabase = globalThis as unknown as {
  __supabaseAdmin?: SupabaseClient;
};

/**
 * supabase-js expects the PROJECT ORIGIN (https://<ref>.supabase.co) and
 * appends `/rest/v1`, `/auth/v1`, etc. itself. If the env value includes a
 * path (e.g. someone pasted the full `/rest/v1/` REST URL) or a trailing
 * slash, the client produces a doubled/invalid path and PostgREST rejects it
 * with "Invalid path specified in request URL". Normalising to `.origin`
 * makes the client tolerant of either form.
 */
function toProjectOrigin(rawUrl: string): string {
  return new URL(rawUrl).origin;
}

function createAdminClient(): SupabaseClient {
  const env = getServerEnv();
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      '[supabase] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required ' +
        'when using the Supabase auth provider. Set AUTH_PROVIDER=local to use PostgreSQL auth.',
    );
  }
  return createClient(toProjectOrigin(env.NEXT_PUBLIC_SUPABASE_URL), env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    realtime: {
      transport: wsTransport,
    },
  });
}

// Lazy singleton — only created on first access so local-auth mode never
// evaluates Supabase credentials at module load time.
export function getSupabaseAdmin(): SupabaseClient {
  if (!globalForSupabase.__supabaseAdmin) {
    globalForSupabase.__supabaseAdmin = createAdminClient();
  }
  return globalForSupabase.__supabaseAdmin;
}
