import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit configuration.
 *
 * `generate` (producing migration SQL from the schema) runs fully offline and
 * does not need a live database. `migrate` / `push` / `studio` do — they read
 * DATABASE_URL from the environment (drizzle-kit auto-loads `.env`; for the
 * Next-style `.env.local`, export DATABASE_URL or copy it into `.env`). The
 * placeholder below only keeps offline `generate` happy when the var is unset.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://placeholder",
  },
  verbose: true,
  strict: true,
});
