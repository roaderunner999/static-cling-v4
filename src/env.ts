import { z } from "zod";

/**
 * Validated environment variables.
 *
 * Stage 0 (foundation): we validate at the point of first use and fail fast
 * with a readable error if anything required is missing or malformed. Import
 * this `env` object instead of reading `process.env` directly so that a typo
 * or a missing secret surfaces immediately rather than as a runtime `undefined`
 * three layers deep.
 *
 * This module is server-only by convention — do not import it into client
 * components (it would leak secrets into the browser bundle).
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // Pooled Postgres connection string (PgBouncer / Fly pooler in front).
  // Local dev -> staticcling_dev, prod (Fly secret) -> staticcling_prod.
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "\n❌ Invalid or missing environment variables:\n" +
      JSON.stringify(parsed.error.issues, null, 2) +
      "\n",
  );
  throw new Error("Invalid environment variables — see the log above.");
}

export const env = parsed.data;
