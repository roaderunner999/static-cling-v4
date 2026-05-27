import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

/**
 * Server-side session access (the Data Access Layer entry point).
 *
 * Server-only: importing `next/headers` makes this module unusable from client
 * components. Wrapped in React's `cache()` so multiple calls within one render
 * pass hit the database at most once.
 *
 * Returns `{ user, session }` or `null` when signed out.
 */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});
