-- =============================================================================
-- RPC: retry_notification_log
-- Row-locked retry guard for the admin notifications retry button.
-- Uses SELECT FOR UPDATE to prevent concurrent double-sends.
-- =============================================================================

CREATE OR REPLACE FUNCTION retry_notification_log(log_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
  FROM notification_log
  WHERE id = log_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification log row not found: %', log_id;
  END IF;

  IF v_status <> 'failed' THEN
    RAISE EXCEPTION 'Row is not in failed status (current: %)', v_status;
  END IF;

  UPDATE notification_log
  SET status = 'queued', error_message = NULL
  WHERE id = log_id;

  RETURN log_id;
END;
$$;
