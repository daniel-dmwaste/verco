-- ============================================================================
-- MUD Module — Migration 6/6: v_mud_next_expected view
-- ============================================================================
-- Read-only view that computes the "next expected booking date" for each
-- Registered MUD based on its cadence and last completed booking.
--
-- Used by:
--   • Admin dashboard "MUDs due for reminder this week" widget
--   • Property detail page MUD section ("Next expected" field)
--
-- Cadence intervals:
--   • Annual    → 365 days
--   • Bi-annual → 180 days
--   • Quarterly →  90 days
--   • Ad-hoc    → NULL (no reminders, by design — Ad-hoc MUDs are reactive)
--
-- For brand-new Registered MUDs with no completed bookings, last_date is NULL
-- and so next_expected_date is also NULL. The dashboard widget can fall back to
-- "first available for_mud=true date" via a separate query if desired.
--
-- collection_date.date is the column name based on the schema (collection_date
-- table). Joining via booking_item.collection_date_id gives us the actual
-- collection day.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_mud_next_expected AS
WITH last_completed AS (
  SELECT b.property_id,
         max(cd.date) AS last_date
    FROM public.booking b
    JOIN public.booking_item bi ON bi.booking_id = b.id
    JOIN public.collection_date cd ON cd.id = bi.collection_date_id
   WHERE b.type = 'MUD'
     AND b.status = 'Completed'
     AND b.property_id IS NOT NULL
   GROUP BY b.property_id
)
SELECT
  ep.id                  AS property_id,
  ep.collection_cadence,
  lc.last_date,
  CASE ep.collection_cadence
    WHEN 'Annual'    THEN (lc.last_date + INTERVAL '365 days')::date
    WHEN 'Bi-annual' THEN (lc.last_date + INTERVAL '180 days')::date
    WHEN 'Quarterly' THEN (lc.last_date + INTERVAL '90 days')::date
    WHEN 'Ad-hoc'    THEN NULL
  END AS next_expected_date
FROM public.eligible_properties ep
LEFT JOIN last_completed lc ON lc.property_id = ep.id
WHERE ep.is_mud = true
  AND ep.mud_onboarding_status = 'Registered';

COMMENT ON VIEW public.v_mud_next_expected IS
  'Computed next-expected collection date per Registered MUD, based on cadence and last Completed booking. Ad-hoc MUDs return NULL (intentional).';
