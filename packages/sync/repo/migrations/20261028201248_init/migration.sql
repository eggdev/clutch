CREATE TABLE "sync_counters" (
	"organization_id" text PRIMARY KEY,
	"next_sync_id" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_events" (
	"organization_id" text,
	"sync_id" bigint,
	"transaction_id" text,
	"changes" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_events_pkey" PRIMARY KEY("organization_id","sync_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sync_events_transaction" ON "sync_events" ("organization_id","transaction_id");