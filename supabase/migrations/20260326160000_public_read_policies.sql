-- Public read policies for tenant resolution and booking wizard
-- These tables are queried on public routes before any auth session exists:
--   - client: tenant resolution in proxy (every request)
--   - collection_area: booking wizard address lookup
--   - eligible_properties: booking wizard address verification
--   - collection_date: booking wizard date selection
--   - category: service grouping in booking wizard
--   - service_type: service selection in booking wizard
--   - service_rules: pricing display in booking wizard
--   - allocation_rules: allocation display in booking wizard
--   - financial_year: FY context in booking wizard

-- Client — needed for tenant resolution which runs before auth
CREATE POLICY client_public_select ON client
  FOR SELECT
  USING (is_active = true);

-- Collection area — public booking needs to resolve property → area
CREATE POLICY collection_area_public_select ON collection_area
  FOR SELECT
  USING (is_active = true);

-- Eligible properties — public address lookup
CREATE POLICY eligible_properties_public_select ON eligible_properties
  FOR SELECT
  USING (true);

-- Collection dates — public date selection
CREATE POLICY collection_date_public_select ON collection_date
  FOR SELECT
  USING (is_open = true);

-- Category — public service grouping
CREATE POLICY category_public_select ON category
  FOR SELECT
  USING (true);

-- Service type — public service selection
CREATE POLICY service_type_public_select ON service_type
  FOR SELECT
  USING (is_active = true);

-- Service rules — public pricing display
CREATE POLICY service_rules_public_select ON service_rules
  FOR SELECT
  USING (true);

-- Allocation rules — public allocation display
CREATE POLICY allocation_rules_public_select ON allocation_rules
  FOR SELECT
  USING (true);

-- Financial year — public FY context
CREATE POLICY financial_year_public_select ON financial_year
  FOR SELECT
  USING (true);
