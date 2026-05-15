-- Per-client place-out window for waste collection.
--
-- The booking-detail page tells residents "Do not place out more than X
-- hours before collection." Different councils have different policies —
-- KWN is 48 hours (2 days), Verge Valet sub-clients (Mosman Park, COT,
-- Vincent, etc.) are 72 hours (3 days). Previously hardcoded to 48 in
-- src/app/(public)/booking/[ref]/booking-detail-client.tsx.
--
-- Stored as integer hours rather than days for future flexibility (e.g.,
-- a 36-hour edge case). The UI formats as "{N} days" when divisible by
-- 24, otherwise "{N} hours".

ALTER TABLE client
  ADD COLUMN IF NOT EXISTS place_out_hours_before integer NOT NULL DEFAULT 48
  CHECK (place_out_hours_before > 0 AND place_out_hours_before <= 168);

COMMENT ON COLUMN client.place_out_hours_before IS
  'Hours before collection that residents may place waste on the verge. UI shows "Do not place out more than X hours before collection." KWN=48 (2d), Verge Valet=72 (3d).';

-- Seed: KWN keeps the default (48). Verge Valet to 72 per council policy.
UPDATE client SET place_out_hours_before = 72 WHERE slug = 'vergevalet';
