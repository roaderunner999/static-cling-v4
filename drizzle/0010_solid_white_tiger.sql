CREATE TABLE "agent" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'New agent' NOT NULL,
	"instruction" text DEFAULT '' NOT NULL,
	"render_target" text DEFAULT 'text' NOT NULL,
	"data_source" text DEFAULT 'claude' NOT NULL,
	"model" text DEFAULT 'claude-sonnet-4-6' NOT NULL,
	"schedule" text DEFAULT 'manual' NOT NULL,
	"budget_cents" integer DEFAULT 5 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_result" jsonb,
	"last_run_at" timestamp with time zone,
	"last_model" text,
	"last_cost_micros" bigint DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_user_idx" ON "agent" USING btree ("user_id","position");