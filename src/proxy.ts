import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Next.js 16 "proxy" (the renamed middleware — runs on the Node.js runtime).
 *
 * This is an *optimistic* gate only: it checks for the presence of a session
 * cookie and bounces signed-out visitors away from protected routes to /login.
 * It deliberately does NOT hit the database — the real authorization checks
 * live close to the data, in `getSession()` and the pages themselves.
 */
const protectedPrefixes = ["/dashboard", "/profile", "/admin"];

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const needsAuth = protectedPrefixes.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!needsAuth) return NextResponse.next();

  const sessionCookie = getSessionCookie(req);
  if (!sessionCookie) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/profile/:path*", "/admin/:path*"],
};
