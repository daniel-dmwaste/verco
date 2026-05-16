-- Targeted indexes for documented hot paths.
--
-- Codex Phase 1 finding. Audited existing indexes via pg_indexes; only adding
-- composites and singletons that don't duplicate what's already there.
-- All targets are small-to-medium tables (audit_log is the largest at growing
-- volume; bookings tens-of-thousands; tickets hundreds). Plain CREATE INDEX
-- (not CONCURRENTLY) is fine because the ACCESS EXCLUSIVE lock is sub-second.
--
-- IF NOT EXISTS on every index — idempotent re-applies under db push.

-- ── booking ─────────────────────────────────────────────────
-- Pricing engine FY-usage scan: WHERE property_id=? AND fy_id=? AND status NOT
-- IN ('Cancelled','Pending Payment'). Runs on every booking wizard step 2
-- (services-form), every confirm step, every create-booking EF call. Was
-- falling back to idx_booking_property → idx_booking_status filter chain.
CREATE INDEX IF NOT EXISTS idx_booking_property_fy
  ON booking (property_id, fy_id);

-- Admin booking list: WHERE client_id=? ORDER BY created_at DESC. Was using
-- idx_booking_client → in-memory sort.
CREATE INDEX IF NOT EXISTS idx_booking_client_status_created
  ON booking (client_id, status, created_at DESC);

-- ── booking_item ────────────────────────────────────────────
-- Service-usage / rule lookups: SELECT WHERE service_id=?. Booking-id lookups
-- already covered by idx_booking_item_booking.
CREATE INDEX IF NOT EXISTS idx_booking_item_service
  ON booking_item (service_id);

-- ── notification_log ────────────────────────────────────────
-- "Have we already sent X for booking Y?" check used by handle-expired-payments
-- cron (currently N+1). With this composite, the anti-join becomes index-only.
CREATE INDEX IF NOT EXISTS idx_notification_log_booking_type_status
  ON notification_log (booking_id, notification_type, status);

-- ── audit_log ──────────────────────────────────────────────
-- Global audit-log page does SELECT ... ORDER BY created_at DESC LIMIT/OFFSET
-- without filters (RLS does the tenant scoping). Was relying on the existing
-- composite (table_name, record_id, created_at DESC) — useless when no
-- table/record filter applies. Pure date-ordered scan needs a standalone
-- created_at index.
CREATE INDEX IF NOT EXISTS idx_audit_log_created
  ON audit_log (created_at DESC);

-- ── non_conformance_notice ─────────────────────────────────
-- Booking → NCN lookup (admin booking detail, field run sheet).
CREATE INDEX IF NOT EXISTS idx_ncn_booking
  ON non_conformance_notice (booking_id);

-- auto-close-notices cron: WHERE status='Issued' AND created_at < threshold.
-- Plus the admin NCN list filtered by status.
CREATE INDEX IF NOT EXISTS idx_ncn_status_created
  ON non_conformance_notice (status, created_at DESC);

-- ── nothing_presented ──────────────────────────────────────
-- Booking → NP lookup (parallel to NCN above).
CREATE INDEX IF NOT EXISTS idx_np_booking
  ON nothing_presented (booking_id);

-- auto-close-notices cron + admin NP list.
CREATE INDEX IF NOT EXISTS idx_np_status_created
  ON nothing_presented (status, created_at DESC);

-- ── service_ticket ─────────────────────────────────────────
-- Admin ticket list filtered by status; cron iterates tickets by status.
-- client_id already indexed; this complements with a status filter.
CREATE INDEX IF NOT EXISTS idx_service_ticket_status_created
  ON service_ticket (status, created_at DESC);
