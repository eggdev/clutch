CREATE TABLE "sync_transactions" (
	"organization_id" text,
	"transaction_id" text,
	"sync_id" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sync_transactions_pkey" PRIMARY KEY("organization_id","transaction_id")
);
