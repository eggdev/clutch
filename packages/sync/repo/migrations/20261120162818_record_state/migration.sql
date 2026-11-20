CREATE TABLE "sync_records" (
	"organization_id" text,
	"model" text,
	"record_id" text,
	"groups" text[] NOT NULL,
	"sync_id" bigint NOT NULL,
	"data" jsonb,
	"deleted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sync_records_pkey" PRIMARY KEY("organization_id","model","record_id")
);
--> statement-breakpoint
CREATE INDEX "sync_records_groups" ON "sync_records" USING gin ("groups");