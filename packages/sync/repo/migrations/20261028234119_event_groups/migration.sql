ALTER TABLE "sync_events" ADD COLUMN "groups" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "sync_events_groups" ON "sync_events" USING gin ("groups");