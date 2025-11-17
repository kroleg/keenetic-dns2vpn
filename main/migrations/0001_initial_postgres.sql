-- Initial PostgreSQL schema migration
-- Migrated from SQLite to PostgreSQL

CREATE TABLE IF NOT EXISTS "services" (
	"id" SERIAL PRIMARY KEY,
	"name" TEXT NOT NULL UNIQUE,
	"interfaces" JSONB NOT NULL,
	"matching_domains" JSONB NOT NULL,
	"optimize_routes" BOOLEAN NOT NULL DEFAULT true,
	"enabled" BOOLEAN NOT NULL DEFAULT true,
	"created_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
	"updated_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "services_name_idx" ON "services" ("name");
