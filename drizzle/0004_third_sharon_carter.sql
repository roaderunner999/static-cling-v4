ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
-- Seed: promote the owner account to admin (idempotent; matches any case).
UPDATE "user" SET "role" = 'admin' WHERE lower("email") = 'admin@lyons.net';