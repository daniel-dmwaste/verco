-- ============================================================================
-- MUD Module — Migration 1/6: enums
-- ============================================================================
-- Creates enum types for MUD onboarding state machine and collection cadence.
-- Must run before columns are added (Migration 2) because the columns reference
-- these types.
--
-- Per Verco session log (2026-04-02 PM): cannot mix CREATE TYPE / ALTER TYPE
-- with DML using the new value in the same transaction. Each enum is created
-- in its own DO block.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE mud_onboarding_status AS ENUM ('Contact Made', 'Registered', 'Inactive');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE collection_cadence AS ENUM ('Ad-hoc', 'Annual', 'Bi-annual', 'Quarterly');
EXCEPTION WHEN duplicate_object THEN null; END $$;
