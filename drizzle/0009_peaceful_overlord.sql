ALTER TABLE "usage_ledger" ADD COLUMN "cache_read_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "cache_creation_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "cost_micros" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Backfill cost_micros for rows written before this column existed. Micro-dollars
-- equal tokens × price-per-Mtok (since USD = tokens × perMtok / 1e6, and micros =
-- USD × 1e6). Cache tokens weren't stored historically, so this uses input/output
-- only — exact for those rows. New rows are written precisely (incl. cache) by recordUsage.
UPDATE "usage_ledger" SET "cost_micros" = CASE "model"
  WHEN 'claude-sonnet-4-6' THEN "input_tokens" * 3 + "output_tokens" * 15
  WHEN 'claude-opus-4-7'   THEN "input_tokens" * 5 + "output_tokens" * 25
  WHEN 'claude-opus-4-6'   THEN "input_tokens" * 5 + "output_tokens" * 25
  WHEN 'claude-haiku-4-5'  THEN "input_tokens" * 1 + "output_tokens" * 5
  ELSE 0 END
WHERE "cost_micros" = 0;