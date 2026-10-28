CREATE TABLE "notes" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
