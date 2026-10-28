CREATE TABLE "space_memberships" (
	"organization_id" text,
	"space_id" text,
	"user_id" text,
	"joined_at" timestamp with time zone NOT NULL,
	CONSTRAINT "space_memberships_pkey" PRIMARY KEY("organization_id","space_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
