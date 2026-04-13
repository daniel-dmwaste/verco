-- notification_log.status CHECK constraint
--
-- Enforces the three valid states for notification_log rows:
--
--   'queued'  — row created, not yet sent. Used by Phase 4 24h expiry
--               flow (handle-expired-payments EF writes a queued row
--               inside the same transaction as the booking status UPDATE,
--               then dispatches by log_id for at-least-once delivery) and
--               by Phase 5 admin retry flow (SELECT FOR UPDATE + set to
--               queued before dispatch).
--   'sent'    — sendEmail returned 2xx, row is terminal.
--   'failed'  — sendEmail returned error OR dispatcher crashed mid-flight,
--               row is terminal for this attempt. Admin can manually retry
--               within 7 days via /admin/notifications.
--
-- Baked in from day one (Phase 0 / VER-118) so Phase 4's queued-first
-- ordering works without a schema migration partway through the rollout.

ALTER TABLE notification_log
  ADD CONSTRAINT notification_log_status_check
  CHECK (status IN ('queued', 'sent', 'failed'));
