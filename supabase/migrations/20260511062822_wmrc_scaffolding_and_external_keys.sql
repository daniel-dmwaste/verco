-- ============================================================
-- WMRC tenant scaffolding + external-key columns
-- ============================================================
-- Two changes in one migration:
--
-- 1. Adds external_source + external_id columns to eligible_properties
--    with a partial UNIQUE index. Existing KWN rows keep these NULL and
--    are unaffected; future Airtable-sourced rows are uniquely keyed
--    on (source, id) for idempotent re-imports.
--
-- 2. Inserts the WMRC client, 9 sub-clients (one per LGA), and 11
--    collection areas (CAM and FRE each split into two). All inserts
--    are ON CONFLICT DO NOTHING so the migration is idempotent.
--
-- Allocation rules, service rules, collection dates, and branding fields
-- are NOT set here — they're deferred to the existing client-config admin
-- UI during onboarding.
-- ============================================================

-- Part A — schema change to eligible_properties
ALTER TABLE eligible_properties
  ADD COLUMN external_source text,
  ADD COLUMN external_id     text;

CREATE UNIQUE INDEX idx_eligible_properties_external
  ON eligible_properties (external_source, external_id)
  WHERE external_source IS NOT NULL;

COMMENT ON COLUMN eligible_properties.external_source IS
  'Source system identifier for imported rows. Format: <system>:<scope_id>.';
COMMENT ON COLUMN eligible_properties.external_id IS
  'Stable identifier in the source system. Used for idempotent re-imports.';


-- Part B — WMRC tenant scaffolding
DO $$
DECLARE
  v_contractor_id uuid;
  v_client_id     uuid;
  v_sc_cot uuid; v_sc_vin uuid; v_sc_cam uuid; v_sc_fre uuid;
  v_sc_sop uuid; v_sc_mos uuid; v_sc_pep uuid; v_sc_sub uuid; v_sc_vic uuid;
BEGIN
  SELECT id INTO v_contractor_id FROM contractor WHERE slug = 'dm';
  IF v_contractor_id IS NULL THEN
    RAISE EXCEPTION 'Contractor with slug=dm not found — run supabase/seed.sql first';
  END IF;

  INSERT INTO client (contractor_id, name, slug, is_active, primary_colour, service_name, show_powered_by)
  VALUES (v_contractor_id, 'Verge Valet', 'vergevalet', true, '#293F52', 'Verge Valet', true)
  ON CONFLICT (slug) DO NOTHING;
  SELECT id INTO v_client_id FROM client WHERE slug = 'vergevalet';

  INSERT INTO sub_client (client_id, code, name, is_active) VALUES
    (v_client_id, 'COT', 'Town of Cottesloe',         true),
    (v_client_id, 'VIN', 'City of Vincent',           true),
    (v_client_id, 'CAM', 'Town of Cambridge',         true),
    (v_client_id, 'FRE', 'City of Fremantle',         true),
    (v_client_id, 'SOP', 'City of South Perth',       true),
    (v_client_id, 'MOS', 'Town of Mosman Park',       true),
    (v_client_id, 'PEP', 'Shire of Peppermint Grove', true),
    (v_client_id, 'SUB', 'City of Subiaco',           true),
    (v_client_id, 'VIC', 'Town of Victoria Park',     true)
  ON CONFLICT (client_id, code) DO NOTHING;

  SELECT id INTO v_sc_cot FROM sub_client WHERE client_id = v_client_id AND code = 'COT';
  SELECT id INTO v_sc_vin FROM sub_client WHERE client_id = v_client_id AND code = 'VIN';
  SELECT id INTO v_sc_cam FROM sub_client WHERE client_id = v_client_id AND code = 'CAM';
  SELECT id INTO v_sc_fre FROM sub_client WHERE client_id = v_client_id AND code = 'FRE';
  SELECT id INTO v_sc_sop FROM sub_client WHERE client_id = v_client_id AND code = 'SOP';
  SELECT id INTO v_sc_mos FROM sub_client WHERE client_id = v_client_id AND code = 'MOS';
  SELECT id INTO v_sc_pep FROM sub_client WHERE client_id = v_client_id AND code = 'PEP';
  SELECT id INTO v_sc_sub FROM sub_client WHERE client_id = v_client_id AND code = 'SUB';
  SELECT id INTO v_sc_vic FROM sub_client WHERE client_id = v_client_id AND code = 'VIC';

  INSERT INTO collection_area (client_id, contractor_id, sub_client_id, name, code, dm_job_code, is_active) VALUES
    (v_client_id, v_contractor_id, v_sc_cot, 'Cottesloe',          'COT',   'VV', true),
    (v_client_id, v_contractor_id, v_sc_vin, 'Vincent',            'VIN',   'VV', true),
    (v_client_id, v_contractor_id, v_sc_cam, 'Cambridge — Area A', 'CAM-A', 'VV', true),
    (v_client_id, v_contractor_id, v_sc_cam, 'Cambridge — Area B', 'CAM-B', 'VV', true),
    (v_client_id, v_contractor_id, v_sc_fre, 'Fremantle — North',  'FRE-N', 'VV', true),
    (v_client_id, v_contractor_id, v_sc_fre, 'Fremantle — South',  'FRE-S', 'VV', true),
    (v_client_id, v_contractor_id, v_sc_sop, 'South Perth',        'SOP',   'VV', true),
    (v_client_id, v_contractor_id, v_sc_mos, 'Mosman Park',        'MOS',   'VV', true),
    (v_client_id, v_contractor_id, v_sc_pep, 'Peppermint Grove',   'PEP',   'VV', true),
    (v_client_id, v_contractor_id, v_sc_sub, 'Subiaco',            'SUB',   'VV', true),
    (v_client_id, v_contractor_id, v_sc_vic, 'Victoria Park',      'VIC',   'VV', true)
  ON CONFLICT (client_id, code) DO NOTHING;
END $$;
