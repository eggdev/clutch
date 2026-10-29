CREATE TABLE "sync_jobs" (
	"id" text PRIMARY KEY,
	"organization_id" text,
	"name" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "sync_jobs_due" ON "sync_jobs" ("status","run_at");