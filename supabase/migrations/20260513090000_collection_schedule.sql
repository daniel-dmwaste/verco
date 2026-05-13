-- Collection date scheduling — schema + seed
--
-- Three new tables:
--   1. collection_schedule       — per-area, per-weekday capacity
--   2. capacity_pool_schedule    — per-pool, per-weekday capacity (MCP only today)
--   3. public_holiday            — dates the generator skips (WA, with name)
--
-- Seed:
--   - collection_schedule: VV cheat-sheet collection days. Pool-member areas
--     (MOS/COT/PEP/FRE-N) get bulk_capacity_limit=0 since capacity is tracked
--     on the pool, not the area.
--   - capacity_pool_schedule: MCP pool, Mon + Wed at 60/day.
--   - public_holiday: WA holidays through to mid-2027.
--
-- The generate-collection-dates Edge Function reads these tables and emits
-- collection_date + collection_date_pool rows for the next N weeks.

-- 1. collection_schedule
CREATE TABLE collection_schedule (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_area_id   uuid NOT NULL REFERENCES collection_area(id) ON DELETE CASCADE,
  day_of_week          smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun, 1=Mon, ..., 6=Sat (matches Postgres EXTRACT(DOW))
  bulk_capacity_limit  integer NOT NULL DEFAULT 0,
  anc_capacity_limit   integer NOT NULL DEFAULT 0,
  id_capacity_limit    integer NOT NULL DEFAULT 0,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_area_id, day_of_week)
);

CREATE INDEX collection_schedule_area_idx ON collection_schedule(collection_area_id) WHERE is_active = true;

CREATE TRIGGER collection_schedule_updated_at
  BEFORE UPDATE ON collection_schedule
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE collection_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY collection_schedule_public_select ON collection_schedule
  FOR SELECT USING (true);

CREATE POLICY collection_schedule_contractor_admin_all ON collection_schedule
  FOR ALL USING (
    current_user_role() IN ('contractor-admin', 'contractor-staff')
    AND collection_area_id IN (
      SELECT id FROM collection_area WHERE contractor_id = current_user_contractor_id()
    )
  );

-- 2. capacity_pool_schedule
CREATE TABLE capacity_pool_schedule (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capacity_pool_id     uuid NOT NULL REFERENCES capacity_pool(id) ON DELETE CASCADE,
  day_of_week          smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  bulk_capacity_limit  integer NOT NULL DEFAULT 0,
  anc_capacity_limit   integer NOT NULL DEFAULT 0,
  id_capacity_limit    integer NOT NULL DEFAULT 0,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (capacity_pool_id, day_of_week)
);

CREATE INDEX capacity_pool_schedule_pool_idx ON capacity_pool_schedule(capacity_pool_id) WHERE is_active = true;

CREATE TRIGGER capacity_pool_schedule_updated_at
  BEFORE UPDATE ON capacity_pool_schedule
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE capacity_pool_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY capacity_pool_schedule_public_select ON capacity_pool_schedule
  FOR SELECT USING (true);

CREATE POLICY capacity_pool_schedule_contractor_admin_all ON capacity_pool_schedule
  FOR ALL USING (
    current_user_role() IN ('contractor-admin', 'contractor-staff')
    AND capacity_pool_id IN (
      SELECT id FROM capacity_pool WHERE contractor_id = current_user_contractor_id()
    )
  );

-- 3. public_holiday
CREATE TABLE public_holiday (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date            date NOT NULL,
  name            text NOT NULL,
  jurisdiction    text NOT NULL DEFAULT 'WA',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (jurisdiction, date)
);

CREATE INDEX public_holiday_date_idx ON public_holiday(date);

CREATE TRIGGER public_holiday_updated_at
  BEFORE UPDATE ON public_holiday
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

ALTER TABLE public_holiday ENABLE ROW LEVEL SECURITY;

CREATE POLICY public_holiday_public_select ON public_holiday
  FOR SELECT USING (true);

-- Holiday list is small + stable; restrict mutations to contractor admins.
CREATE POLICY public_holiday_contractor_admin_all ON public_holiday
  FOR ALL USING (current_user_role() IN ('contractor-admin', 'contractor-staff'));

-- =========================================================================
-- Seed: VV collection schedule from the Contract Cheat Sheet.
-- Pool-member areas (MOS, COT, PEP, FRE-N) get bulk_capacity_limit=0 here
-- because capacity for those areas is tracked on the pool schedule below.
-- =========================================================================
WITH vv_areas AS (
  SELECT id, code FROM collection_area
  WHERE sub_client_id IN (
    SELECT id FROM sub_client WHERE client_id = (SELECT id FROM client WHERE slug = 'vergevalet')
  )
),
schedule AS (
  -- area_code, day_of_week, bulk_cap
  --   day_of_week: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
  --   pool members have bulk_cap=0 (pool tracks)
  SELECT * FROM (VALUES
    ('CAM-A'::text, 1::smallint, 60::integer),  -- A-Mon
    ('CAM-B',       3,           60),            -- B-Wed
    ('COT',         1,           0),             -- pooled (MCP Mon)
    ('COT',         3,           0),             -- pooled (MCP Wed)
    ('FRE-N',       1,           0),             -- pooled (MCP Mon)
    ('FRE-S',       3,           60),            -- Wed
    ('MOS',         1,           0),             -- pooled (MCP Mon)
    ('MOS',         3,           0),             -- pooled (MCP Wed)
    ('PEP',         1,           0),             -- pooled (MCP Mon)
    ('PEP',         3,           0),             -- pooled (MCP Wed)
    ('SOP',         2,           60),            -- Tue
    ('SOP',         4,           60),            -- Thu
    ('SUB',         5,           60),            -- Fri
    ('VIC',         1,           60),            -- Mon
    ('VIC',         3,           60),            -- Wed
    ('VIN',         2,           60),            -- Tue
    ('VIN',         4,           60)             -- Thu
  ) AS s(area_code, day_of_week, bulk_cap)
)
INSERT INTO collection_schedule (collection_area_id, day_of_week, bulk_capacity_limit)
SELECT a.id, s.day_of_week, s.bulk_cap
FROM schedule s
JOIN vv_areas a ON a.code = s.area_code
ON CONFLICT (collection_area_id, day_of_week) DO UPDATE
  SET bulk_capacity_limit = EXCLUDED.bulk_capacity_limit,
      updated_at = now();

-- =========================================================================
-- Seed: MCP capacity pool schedule (Mon + Wed at 60/day shared).
-- =========================================================================
INSERT INTO capacity_pool_schedule (capacity_pool_id, day_of_week, bulk_capacity_limit)
SELECT cp.id, dow, 60
FROM capacity_pool cp
JOIN contractor c ON c.id = cp.contractor_id
CROSS JOIN (VALUES (1::smallint), (3::smallint)) AS d(dow)
WHERE cp.code = 'MCP' AND c.slug = 'dmwm'
ON CONFLICT (capacity_pool_id, day_of_week) DO UPDATE
  SET bulk_capacity_limit = EXCLUDED.bulk_capacity_limit,
      updated_at = now();

-- =========================================================================
-- Seed: WA public holidays from May 2026 through June 2027.
-- Notes:
--   - Boxing Day 2026 falls on Saturday — substitute Monday is 28 Dec 2026.
--   - ANZAC Day 2027 falls on Sunday — substitute Monday is 26 Apr 2027
--     (per WA Public and Bank Holidays Act 1972, as amended).
--   - Saturday holidays not on a collection day are omitted (ANZAC 2026,
--     Boxing 2026 itself) — only the observed-day substitution matters.
--   - This list must be re-seeded annually. Track as a 12-month checklist
--     item.
-- =========================================================================
INSERT INTO public_holiday (date, name, jurisdiction) VALUES
  ('2026-06-01', 'WA Day',                'WA'),
  ('2026-09-28', 'King''s Birthday',      'WA'),
  ('2026-12-25', 'Christmas Day',         'WA'),
  ('2026-12-28', 'Boxing Day (observed)', 'WA'),
  ('2027-01-01', 'New Year''s Day',       'WA'),
  ('2027-01-26', 'Australia Day',         'WA'),
  ('2027-03-01', 'Labour Day',            'WA'),
  ('2027-03-26', 'Good Friday',           'WA'),
  ('2027-03-29', 'Easter Monday',         'WA'),
  ('2027-04-26', 'ANZAC Day (observed)',  'WA'),
  ('2027-06-07', 'WA Day',                'WA')
ON CONFLICT (jurisdiction, date) DO NOTHING;

-- Sanity check: confirm expected row counts after seeding.
DO $$
DECLARE
  v_schedule_count integer;
  v_pool_schedule_count integer;
  v_holiday_count integer;
BEGIN
  SELECT COUNT(*) INTO v_schedule_count FROM collection_schedule cs
  JOIN collection_area ca ON ca.id = cs.collection_area_id
  JOIN sub_client sc ON sc.id = ca.sub_client_id
  WHERE sc.client_id = (SELECT id FROM client WHERE slug = 'vergevalet');

  IF v_schedule_count <> 17 THEN
    RAISE EXCEPTION 'Expected 17 collection_schedule rows for VV, got %', v_schedule_count;
  END IF;

  SELECT COUNT(*) INTO v_pool_schedule_count FROM capacity_pool_schedule cps
  JOIN capacity_pool cp ON cp.id = cps.capacity_pool_id
  WHERE cp.code = 'MCP';

  IF v_pool_schedule_count <> 2 THEN
    RAISE EXCEPTION 'Expected 2 capacity_pool_schedule rows for MCP, got %', v_pool_schedule_count;
  END IF;

  SELECT COUNT(*) INTO v_holiday_count FROM public_holiday WHERE jurisdiction = 'WA';

  IF v_holiday_count < 11 THEN
    RAISE EXCEPTION 'Expected at least 11 WA holidays seeded, got %', v_holiday_count;
  END IF;
END $$;
