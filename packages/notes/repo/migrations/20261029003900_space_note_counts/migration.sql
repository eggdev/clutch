CREATE TABLE "space_note_counts" (
	"organization_id" text,
	"space_id" text,
	"note_count" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "space_note_counts_pkey" PRIMARY KEY("organization_id","space_id")
);
