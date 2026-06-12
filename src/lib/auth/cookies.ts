/**
 * Session-cookie options — centralised so every set/clear site uses identical
 * security flags. If a flag changes, change it here and everywhere updates.
 *
 * WHY HTTP-ONLY:
 *  - JavaScript on the page (including any XSS payload) cannot read or
 *    exfiltrate an HTTP-only cookie. The session never lives in
 *    localStorage / sessionStorage / a JS variable — only in this cookie,
 *    which is attached to requests by the browser automatically.
 *
 * WHY SAME-SITE LAX:
 *  - Blocks CSRF on cross-site POST/PUT/DELETE while still letting normal
 *    top-level navigations (links, redirects from the OAuth-style login flow)
 *    carry the cookie. `strict` would break our post-login redirect UX.
 *
 * WHY SECURE ONLY IN PRODUCTION:
 *  - `secure: true` requires HTTPS. Local dev runs on http://localhost where
 *    a secure cookie would never be sent, locking out development. Production
 *    on Vercel is always HTTPS, so we flip it on there.
 *
 * The shape is intentionally a plain object so it works with BOTH
 * `NextResponse.cookies.set(opts)` (route handlers) and
 * `(await cookies()).set(opts)` (server components/actions).
 */
import { AUTH_COOKIE_NAME, JWT_MAX_AGE_SECONDS } from '@/src/features/auth/constants';

/** Re-export so callers don't reach across feature boundaries for the name. */
export { AUTH_COOKIE_NAME as SESSION_COOKIE_NAME };

export interface SessionCookieOptions {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
}

/** Options to ATTACH a freshly signed session JWT to the response. */
export function sessionCookieFor(token: string): SessionCookieOptions {
  return {
    name: AUTH_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: JWT_MAX_AGE_SECONDS,
  };
}

/**
 * Options that immediately expire the session cookie. Same name/path/flags as
 * the set call — browsers only overwrite a cookie when the (name, path,
 * domain) tuple matches the original, so the flags MUST match.
 */
export function clearedSessionCookie(): SessionCookieOptions {
  return {
    name: AUTH_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  };
}
