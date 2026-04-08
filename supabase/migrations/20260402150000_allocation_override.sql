-- Recovered from live DB migration history on 2026-04-08.
-- This migration was applied directly via Supabase Studio and never committed
-- to git. Reconstructed verbatim from supabase_migrations.schema_migrations.
--
-- KNOWN ISSUE: timestamp ordering — see 20260402141720_allocation_override_service_level.sql
-- The service-level migration drops `category_id` and renames `set_remaining`,
-- but is timestamped earlier than this CREATE TABLE. The live DB applied them
-- in author order. On a fresh `supabase db reset`, this file would need to run
-- BEFORE the service-level one.

-- ============================================================
-- Allocation Override Feature
-- ============================================================
-- Allows admins to manually adjust property allocations
-- for cases like new owner reinstatement or council credits.
--
-- Implementation: set_remaining semantics
--   new_remaining = override.set_remaining
--   effective_from = override.created_at
--   only free_units consume category budget after override
--
-- Constraints:
--   - Only one active override per (property_id, category_id) per FY
--   - Overrides use set_remaining not add_units (clear audit trail)
--   - Approval workflow managed by admin user_role check

CREATE TABLE allocation_override (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id           uuid NOT NULL REFERENCES eligible_properties(id) ON DELETE CASCADE,
  category_id           uuid NOT NULL REFERENCES category(id),
  fy_id                 uuid NOT NULL REFERENCES financial_year(id),
  set_remaining         integer NOT NULL CHECK (set_remaining >= 0),
  reason                text NOT NULL,
  created_by            uuid NOT NULL REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, category_id, fy_id, created_at DESC NULLS LAST)
);

CREATE TRIGGER allocation_override_updated_at BEFORE UPDATE ON allocation_override
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Index for admin list views: most recent override per (property_id, category_id, fy_id)
CREATE INDEX idx_allocation_override_property_fy ON allocation_override(property_id, fy_id);
CREATE INDEX idx_allocation_override_category ON allocation_override(category_id, fy_id);

-- Enable RLS
ALTER TABLE allocation_override ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Only client-admins and contractors-admins can view overrides
CREATE POLICY allocation_override_select ON allocation_override FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' IN ('client-admin', 'contractor-admin')
    )
  );

-- Only client-admins and contractor-admins can insert overrides
CREATE POLICY allocation_override_insert ON allocation_override FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' IN ('client-admin', 'contractor-admin')
    )
  );

-- Only client-admins and contractor-admins can update their own overrides
CREATE POLICY allocation_override_update ON allocation_override FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' IN ('client-admin', 'contractor-admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' IN ('client-admin', 'contractor-admin')
    )
  );

-- Only client-admins and contractor-admins can delete overrides
CREATE POLICY allocation_override_delete ON allocation_override FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' IN ('client-admin', 'contractor-admin')
    )
  );
