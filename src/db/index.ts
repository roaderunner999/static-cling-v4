import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/env";
import * as schema from "@/db/schema";

/**
 * Shared Postgres connection + Drizzle client.
 *
 * `prepare: false` keeps prepared statements off so the app works behind a
 * transaction-mode pooler (PgBouncer / Fly pooler), which is how Stage 0
 * provisions Postgres. Import { db } from "@/db" everywhere you query.
 */
const client = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(client, { schema });
