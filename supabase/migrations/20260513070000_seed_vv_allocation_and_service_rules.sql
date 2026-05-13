-- Seed Verge Valet allocation_rules + service_rules for the 11 collection areas
-- under the `vergevalet` client (9 sub-clients: CAM, COT, FRE, MOS, PEP, SOP, SUB, VIC, VIN).
--
-- Source: Contract Cheat Sheet (OneDrive, confirmed with Dan 2026-05-13)
-- Scope:  Bulk category only. Verge Valet does NOT run Ancillary collections —
--         mattresses roll into General waste — so no anc rules are seeded.
--         Daily collection_date caps are out of scope (MCP shared-cap design pending).
--
-- Per-area rules:
--   bulk category max = General free + Green free (dual-limit total)
--   service_rules row created only for services OFFERED at that area:
--     - FRE-N + FRE-S: General only (no Green)
--     - SUB: Green only (no General)
--   ON CONFLICT DO UPDATE keeps the migration idempotent.

WITH
seed AS (
  SELECT * FROM (VALUES
    ('CAM-A'::text, 3, 2::integer, 195.45::numeric, 1::integer, 114.55::numeric),
    ('CAM-B',       3, 2,          195.45,          1,          114.55),
    ('COT',         3, 2,          168.18,          1,          105.45),
    ('FRE-N',       1, 1,          195.45,          NULL,       NULL),
    ('FRE-S',       1, 1,          195.45,          NULL,       NULL),
    ('MOS',         3, 2,          168.18,          1,          105.45),
    ('PEP',         6, 3,          168.18,          3,          105.45),
    ('SOP',         3, 1,          195.45,          2,          114.55),
    ('SUB',         3, NULL,       NULL,            3,          114.55),
    ('VIC',         3, 2,          195.45,          1,          114.55),
    ('VIN',         3, 2,          195.45,          1,          114.55)
  ) AS s(area_code, bulk_max, gen_max, gen_price, grn_max, grn_price)
),
ids AS (
  SELECT
    (SELECT id FROM category WHERE code = 'bulk') AS bulk_cat_id,
    (SELECT id FROM service WHERE name = 'General' AND category_id = (SELECT id FROM category WHERE code = 'bulk')) AS general_id,
    (SELECT id FROM service WHERE name = 'Green'   AND category_id = (SELECT id FROM category WHERE code = 'bulk')) AS green_id
),
areas AS (
  SELECT id, code FROM collection_area
  WHERE sub_client_id IN (
    SELECT id FROM sub_client WHERE client_id = (SELECT id FROM client WHERE slug = 'vergevalet')
  )
),
upsert_allocations AS (
  INSERT INTO allocation_rules (collection_area_id, category_id, max_collections)
  SELECT a.id, ids.bulk_cat_id, seed.bulk_max
  FROM seed
  JOIN areas a ON a.code = seed.area_code
  CROSS JOIN ids
  ON CONFLICT (collection_area_id, category_id)
  DO UPDATE SET max_collections = EXCLUDED.max_collections, updated_at = now()
  RETURNING 1
)
INSERT INTO service_rules (collection_area_id, service_id, max_collections, extra_unit_price)
SELECT a.id, ids.general_id, seed.gen_max, seed.gen_price
FROM seed
JOIN areas a ON a.code = seed.area_code
CROSS JOIN ids
WHERE seed.gen_max IS NOT NULL
UNION ALL
SELECT a.id, ids.green_id, seed.grn_max, seed.grn_price
FROM seed
JOIN areas a ON a.code = seed.area_code
CROSS JOIN ids
WHERE seed.grn_max IS NOT NULL
ON CONFLICT (collection_area_id, service_id)
DO UPDATE SET
  max_collections  = EXCLUDED.max_collections,
  extra_unit_price = EXCLUDED.extra_unit_price,
  updated_at       = now();

-- Sanity check — row counts must match the cheat sheet shape.
-- 11 allocation_rules rows (one bulk row per area)
-- 19 service_rules rows: 10 General (skip SUB) + 9 Green (skip FRE-N, FRE-S)
DO $$
DECLARE
  alloc_count INT;
  svc_count   INT;
  vv_client_id UUID := (SELECT id FROM client WHERE slug = 'vergevalet');
BEGIN
  SELECT COUNT(*) INTO alloc_count
  FROM allocation_rules ar
  JOIN collection_area ca ON ca.id = ar.collection_area_id
  JOIN sub_client sc       ON sc.id = ca.sub_client_id
  WHERE sc.client_id = vv_client_id;

  IF alloc_count <> 11 THEN
    RAISE EXCEPTION 'Expected 11 allocation_rules rows for vergevalet, got %', alloc_count;
  END IF;

  SELECT COUNT(*) INTO svc_count
  FROM service_rules sr
  JOIN collection_area ca ON ca.id = sr.collection_area_id
  JOIN sub_client sc       ON sc.id = ca.sub_client_id
  WHERE sc.client_id = vv_client_id;

  IF svc_count <> 19 THEN
    RAISE EXCEPTION 'Expected 19 service_rules rows for vergevalet, got %', svc_count;
  END IF;
END $$;
