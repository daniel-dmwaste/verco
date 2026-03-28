-- =============================================================================
-- Schema Restructure: category → service, new category table
-- =============================================================================
-- Old: category (General, Green, Mattress...) with capacity_bucket enum
-- New: service (General, Green, Mattress...) with FK to new category table
--      category (Bulk, Ancillary, Illegal Dumping) replaces capacity_bucket
-- =============================================================================

-- ── Step 1: Drop allocation_rules (will recreate with new FK) ───────────────
DROP TABLE IF EXISTS allocation_rules;

-- ── Step 2: Rename service_type → service ───────────────────────────────────
-- Drop policies on service_type first
DROP POLICY IF EXISTS service_type_public_select ON service_type;
DROP POLICY IF EXISTS service_type_select ON service_type;

ALTER TABLE service_type RENAME TO service;

-- Recreate policies on renamed table
CREATE POLICY service_public_select ON service FOR SELECT USING (is_active = true);
CREATE POLICY service_select ON service FOR SELECT USING (auth.uid() IS NOT NULL);

-- Rename FK columns that reference service (old service_type_id → service_id)
ALTER TABLE booking_item RENAME COLUMN service_type_id TO service_id;
ALTER TABLE service_rules RENAME COLUMN service_type_id TO service_id;

-- ── Step 3: Rename old category → service's category_id stays but we need
-- to handle the table rename carefully ────────────────────────────────────────

-- Save the data from old category table
CREATE TEMP TABLE _old_category AS SELECT * FROM category;

-- Drop policies on old category
DROP POLICY IF EXISTS category_public_select ON category;
DROP POLICY IF EXISTS category_select ON category;

-- Drop FK from service.category_id → old category before dropping
ALTER TABLE service DROP CONSTRAINT IF EXISTS service_type_category_id_fkey;

-- Drop the old category table
DROP TABLE category;

-- ── Step 4: Create new category table (Bulk, Ancillary, ID) ─────────────────
CREATE TABLE category (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL UNIQUE,
  code         text NOT NULL UNIQUE,
  description  text,
  sort_order   integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE category ENABLE ROW LEVEL SECURITY;
CREATE POLICY category_public_select ON category FOR SELECT USING (is_active = true);

-- Seed categories
INSERT INTO category (name, code, description, sort_order) VALUES
  ('Bulk',            'bulk', 'General and Green Waste collections', 1),
  ('Ancillary',       'anc',  'Mattress, E-Waste and Whitegoods collections', 2),
  ('Illegal Dumping', 'id',   'Ranger-created illegal dumping collections', 3);

-- ── Step 5: Update service table — replace old category_id with FK to new category ──
-- The column category_id already exists on service (was FK to old category table).
-- We need to update its values to point to the new category table.

-- Map old capacity_bucket values to new category IDs via the temp table
UPDATE service s SET category_id = (
  SELECT c.id FROM category c
  WHERE c.code = (SELECT oc.capacity_bucket::text FROM _old_category oc WHERE oc.id = s.category_id)
);

-- Re-add FK constraint
ALTER TABLE service ADD CONSTRAINT service_category_id_fkey
  FOREIGN KEY (category_id) REFERENCES category(id);

-- Clean up temp table
DROP TABLE _old_category;

-- ── Step 6: Recreate allocation_rules with FK to new category ───────────────
CREATE TABLE allocation_rules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_area_id  uuid NOT NULL REFERENCES collection_area(id) ON DELETE CASCADE,
  category_id         uuid NOT NULL REFERENCES category(id),
  max_collections     integer NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_area_id, category_id)
);

ALTER TABLE allocation_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY allocation_rules_public_select ON allocation_rules FOR SELECT USING (true);

-- Re-seed KWN-1 allocation rules
INSERT INTO allocation_rules (collection_area_id, category_id, max_collections)
SELECT ca.id, c.id, 2
FROM collection_area ca, category c
WHERE ca.code = 'KWN-1' AND c.code = 'bulk';

INSERT INTO allocation_rules (collection_area_id, category_id, max_collections)
SELECT ca.id, c.id, 3
FROM collection_area ca, category c
WHERE ca.code = 'KWN-1' AND c.code = 'anc';

-- ── Step 7: Update service_rules FK constraint name ─────────────────────────
-- The old FK was service_rules_service_type_id_fkey, column is now service_id
ALTER TABLE service_rules DROP CONSTRAINT IF EXISTS service_rules_service_type_id_fkey;
ALTER TABLE service_rules ADD CONSTRAINT service_rules_service_id_fkey
  FOREIGN KEY (service_id) REFERENCES service(id);

-- Update booking_item FK constraint name
ALTER TABLE booking_item DROP CONSTRAINT IF EXISTS booking_item_service_type_id_fkey;
ALTER TABLE booking_item ADD CONSTRAINT booking_item_service_id_fkey
  FOREIGN KEY (service_id) REFERENCES service(id);

-- ── Step 8: Update service_rules unique constraint ──────────────────────────
ALTER TABLE service_rules DROP CONSTRAINT IF EXISTS service_rules_collection_area_id_service_type_id_key;
ALTER TABLE service_rules ADD CONSTRAINT service_rules_collection_area_id_service_id_key
  UNIQUE (collection_area_id, service_id);
