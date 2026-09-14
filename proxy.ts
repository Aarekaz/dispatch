import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const SIGN_IN = "/sign-in";
const APP = "/app";
// Pages that anyone can reach without a session.
const PUBLIC = new Set([
  "/",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
]);

/**
 * Optimistic session-cookie gate.
 *
 * Per Better Auth's Next.js guide: only check the session cookie's presence,
 * never fetch /api/auth/get-session from middleware. Cookie presence is not
 * a security boundary; protected pages/route handlers still re-validate via
 * auth-server's isAuthenticated() / getToken().
 */
export function proxy(request: NextRequest) {
  const session = getSessionCookie(request);
  const { pathname } = request.nextUrl;

  if (session && pathname === SIGN_IN) {
    return NextResponse.redirect(new URL(APP, request.url));
  }
  if (!session && !PUBLIC.has(pathname)) {
    return NextResponse.redirect(new URL(SIGN_IN, request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Broad page coverage; exclude /api, Next internals, and any path with a
  // dot (static assets). Safe with getSessionCookie because that helper
  // doesn't fetch — there's no recursion vector to /api/auth/*.
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
