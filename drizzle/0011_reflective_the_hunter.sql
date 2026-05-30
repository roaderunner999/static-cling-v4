CREATE TABLE "room_message" (
	"id" text PRIMARY KEY NOT NULL,
	"room" text NOT NULL,
	"author_id" text,
	"author_name" text NOT NULL,
	"kind" text DEFAULT 'human' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "room_message_room_idx" ON "room_message" USING btree ("room","created_at");