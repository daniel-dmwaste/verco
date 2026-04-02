-- Allocation override: manual adjustment of property allocations
-- Use cases: new owner reinstatement, council credits, error corrections

CREATE TABLE allocation_override (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id           uuid NOT NULL REFERENCES eligible_properties(id) ON DELETE CASCADE,
  category_id           uuid NOT NULL REFERENCES category(id),
  fy_id                 uuid NOT NULL REFERENCES financial_year(id),
  set_remaining         integer NOT NULL CHECK (set_remaining >= 0),
  reason                text NOT NULL,
  created_by            uuid NOT NULL REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER allocation_override_updated_at BEFORE UPDATE ON allocation_override
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE INDEX idx_allocation_override_property_fy ON allocation_override(property_id, fy_id);
CREATE INDEX idx_allocation_override_category ON allocation_override(category_id, fy_id);

ALTER TABLE allocation_override ENABLE ROW LEVEL SECURITY;

-- RLS: uses current_user_role() (Verco pattern, not raw_user_meta_data)
CREATE POLICY allocation_override_select ON allocation_override FOR SELECT
  TO authenticated
  USING (current_user_role() IN ('contractor-admin', 'contractor-staff', 'client-admin', 'client-staff'));

CREATE POLICY allocation_override_insert ON allocation_override FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid() AND current_user_role() IN ('contractor-admin', 'client-admin'));

CREATE POLICY allocation_override_update ON allocation_override FOR UPDATE
  TO authenticated
  USING (current_user_role() IN ('contractor-admin', 'client-admin'))
  WITH CHECK (current_user_role() IN ('contractor-admin', 'client-admin'));

CREATE POLICY allocation_override_delete ON allocation_override FOR DELETE
  TO authenticated
  USING (current_user_role() IN ('contractor-admin', 'client-admin'));
