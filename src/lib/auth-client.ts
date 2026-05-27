"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client. With no baseURL it targets the current
 * origin's /api/auth, which is exactly what we want for a same-domain app.
 *
 * Reads no secrets — safe to import into client components.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
