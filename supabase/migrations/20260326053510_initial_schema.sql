-- ============================================================
-- Verco v2 — Initial Schema Migration
-- ============================================================

-- ------------------------------------------------------------
-- EXTENSIONS
-- ------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ------------------------------------------------------------
-- ENUMS
-- ------------------------------------------------------------

CREATE TYPE app_role AS ENUM (
  'contractor-admin',
  'contractor-staff',
  'field',
  'client-admin',
  'client-staff',
  'ranger',
  'resident',
  'strata'
);

CREATE TYPE booking_status AS ENUM (
  'Pending Payment',
  'Submitted',
  'Confirmed',
  'Scheduled',
  'Completed',
  'Cancelled',
  'Non-conformance',
  'Nothing Presented',
  'Rebooked',
  'Missed Collection'
);

CREATE TYPE booking_type AS ENUM (
  'Residential',
  'MUD',
  'Illegal Dumping',
  'Call Back - DM',
  'Call Back - Client'
);

CREATE TYPE capacity_bucket AS ENUM ('bulk', 'anc', 'id');

CREATE TYPE ncn_reason AS ENUM (
  'Collection Limit Exceeded',
  'Items Obstructed or Not On Verge',
  'Building Waste',
  'Car Parts',
  'Asbestos / Fibre Fence',
  'Food or Domestic Waste',
  'Glass',
  'Medical Waste',
  'Tyres',
  'Greens in Container',
  'Hazardous Waste',
  'Items Oversize',
  'Other'
);

CREATE TYPE ncn_status AS ENUM ('Open', 'Under Review', 'Resolved', 'Rescheduled');
CREATE TYPE np_status  AS ENUM ('Open', 'Under Review', 'Resolved', 'Rebooked');

CREATE TYPE ticket_category AS ENUM ('general','booking','billing','service','complaint','other');
CREATE TYPE ticket_channel  AS ENUM ('portal','phone','email','form');
CREATE TYPE ticket_priority AS ENUM ('low','normal','high','urgent');
CREATE TYPE ticket_status   AS ENUM ('open','in_progress','waiting_on_customer','resolved','closed');

CREATE TYPE app_permission_action AS ENUM ('view','create','edit','delete','manage');

CREATE TYPE bug_report_category AS ENUM ('ui','data','performance','access','booking','collection','billing','other');
CREATE TYPE bug_report_priority AS ENUM ('low','medium','high','critical');
CREATE TYPE bug_report_status   AS ENUM ('new','triaged','in_progress','resolved','closed','wont_fix');


-- ------------------------------------------------------------
-- UPDATED_AT TRIGGER FUNCTION
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ------------------------------------------------------------
-- CORE HIERARCHY TABLES
-- ------------------------------------------------------------

CREATE TABLE contractor (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER contractor_updated_at BEFORE UPDATE ON contractor
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE client (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id             uuid NOT NULL REFERENCES contractor(id),
  name                      text NOT NULL,
  slug                      text NOT NULL UNIQUE,
  custom_domain             text,
  is_active                 boolean NOT NULL DEFAULT true,
  -- Branding
  logo_light_url            text,
  logo_dark_url             text,
  primary_colour            text,
  service_name              text,
  hero_banner_url           text,
  show_powered_by           boolean NOT NULL DEFAULT true,
  -- Content slots
  landing_headline          text,
  landing_subheading        text,
  contact_name              text,
  contact_phone             text,
  contact_email             text,
  privacy_policy_url        text,
  email_footer_html         text,
  faq_items                 jsonb,
  -- Notification config
  sms_sender_id             text,
  reply_to_email            text,
  email_from_name           text,
  sms_reminder_days_before  integer,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_contractor ON client(contractor_id);
CREATE TRIGGER client_updated_at BEFORE UPDATE ON client
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE sub_client (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES client(id),
  name        text NOT NULL,
  code        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, code)
);
CREATE TRIGGER sub_client_updated_at BEFORE UPDATE ON sub_client
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE collection_area (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES client(id),
  sub_client_id   uuid REFERENCES sub_client(id),
  contractor_id   uuid NOT NULL REFERENCES contractor(id),
  name            text NOT NULL,
  code            text NOT NULL,
  dm_job_code     text,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, code)
);
CREATE INDEX idx_collection_area_client ON collection_area(client_id);
CREATE INDEX idx_collection_area_contractor ON collection_area(contractor_id);
CREATE TRIGGER collection_area_updated_at BEFORE UPDATE ON collection_area
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();


-- ------------------------------------------------------------
-- AUTH & USERS
-- ------------------------------------------------------------

CREATE TABLE profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         text NOT NULL,
  display_name  text,
  contact_id    uuid,  -- FK added after contacts table
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE user_roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role            app_role NOT NULL,
  contractor_id   uuid REFERENCES contractor(id),
  client_id       uuid REFERENCES client(id),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id),
  CONSTRAINT chk_contractor_role CHECK (
    (role IN ('contractor-admin','contractor-staff','field') AND contractor_id IS NOT NULL)
    OR role NOT IN ('contractor-admin','contractor-staff','field')
  ),
  CONSTRAINT chk_client_role CHECK (
    (role IN ('client-admin','client-staff','ranger') AND client_id IS NOT NULL)
    OR role NOT IN ('client-admin','client-staff','ranger')
  )
);
CREATE TRIGGER user_roles_updated_at BEFORE UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();


-- ------------------------------------------------------------
-- CONTACTS
-- ------------------------------------------------------------

CREATE TABLE contacts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name            text NOT NULL,
  mobile_e164          text NOT NULL,
  email                text NOT NULL,
  attio_person_id      text,
  attio_person_web_url text,
  last_synced_by       text DEFAULT 'supabase',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Now add the FK from profiles to contacts
ALTER TABLE profiles ADD CONSTRAINT profiles_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES contacts(id);


-- ------------------------------------------------------------
-- SERVICE TYPES & CATEGORIES
-- ------------------------------------------------------------

CREATE TABLE category (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL UNIQUE,
  capacity_bucket  capacity_bucket NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER category_updated_at BEFORE UPDATE ON category
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

INSERT INTO category (name, capacity_bucket) VALUES
  ('General',         'bulk'),
  ('Green',           'bulk'),
  ('Mattress',        'anc'),
  ('E-Waste',         'anc'),
  ('Whitegoods',      'anc'),
  ('Illegal Dumping', 'id');

CREATE TABLE service_type (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  category_id  uuid NOT NULL REFERENCES category(id),
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER service_type_updated_at BEFORE UPDATE ON service_type
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();


-- ------------------------------------------------------------
-- FINANCIAL YEAR
-- ------------------------------------------------------------

CREATE TABLE financial_year (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label          text NOT NULL,
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  rollover_date  date NOT NULL,
  is_current     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uidx_financial_year_current ON financial_year (is_current) WHERE is_current = true;
CREATE TRIGGER financial_year_updated_at BEFORE UPDATE ON financial_year
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();


-- ------------------------------------------------------------
-- ALLOCATION & SERVICE RULES
-- ------------------------------------------------------------

CREATE TABLE allocation_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_area_id    uuid NOT NULL REFERENCES collection_area(id) ON DELETE CASCADE,
  category_id           uuid NOT NULL REFERENCES category(id),
  max_collections       integer NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_area_id, category_id)
);
CREATE TRIGGER allocation_rules_updated_at BEFORE UPDATE ON allocation_rules
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE service_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_area_id    uuid NOT NULL REFERENCES collection_area(id) ON DELETE CASCADE,
  service_type_id       uuid NOT NULL REFERENCES service_type(id),
  max_collections       integer NOT NULL,
  extra_unit_price      numeric NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_area_id, service_type_id)
);
CREATE TRIGGER service_rules_updated_at BEFORE UPDATE ON service_rules
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();


-- ------------------------------------------------------------
-- PROPERTIES
-- ------------------------------------------------------------

CREATE TABLE eligible_properties (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_area_id    uuid NOT NULL REFERENCES collection_area(id),
  address               text NOT NULL,
  formatted_address     text,
  latitude              numeric,
  longitude             numeric,
  google_place_id       text,
  has_geocode           boolean NOT NULL DEFAULT false,
  is_mud                boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_eligible_properties_area ON eligible_properties(collection_area_id);
CREATE INDEX idx_eligible_properties_mud ON eligible_properties(collection_area_id) WHERE is_mud = true;
CREATE TRIGGER eligible_properties_updated_at BEFORE UPDATE ON eligible_properties
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE strata_user_properties (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  property_id  uuid NOT NULL REFERENCES eligible_properties(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, property_id)
);


-- ------------------------------------------------------------
-- COLLECTION DATES
-- ------------------------------------------------------------

CREATE TABLE collection_date (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_area_id    uuid NOT NULL REFERENCES collection_area(id),
  date                  date NOT NULL,
  is_open               boolean NOT NULL DEFAULT true,
  for_mud               boolean NOT NULL DEFAULT false,
  bulk_capacity_limit   integer NOT NULL DEFAULT 60,
  bulk_units_booked     integer NOT NULL DEFAULT 0,
  bulk_is_closed        boolean NOT NULL DEFAULT false,
  anc_capacity_limit    integer NOT NULL DEFAULT 60,
  anc_units_booked      integer NOT NULL DEFAULT 0,
  anc_is_closed         boolean NOT NULL DEFAULT false,
  id_capacity_limit     integer NOT NULL DEFAULT 10,
  id_units_booked       integer NOT NULL DEFAULT 0,
  id_is_closed          boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_area_id, date)
);
CREATE INDEX idx_collection_date_area_date ON collection_date(collection_area_id, date);
CREATE TRIGGER collection_date_updated_at BEFORE UPDATE ON collection_date
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();


-- ------------------------------------------------------------
-- BOOKINGS
-- ------------------------------------------------------------

CREATE TABLE booking (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref                   text NOT NULL UNIQUE,
  type                  booking_type NOT NULL DEFAULT 'Residential',
  status                booking_status NOT NULL DEFAULT 'Submitted',
  property_id           uuid REFERENCES eligible_properties(id),
  contact_id            uuid REFERENCES contacts(id),
  collection_area_id    uuid NOT NULL REFERENCES collection_area(id),
  client_id             uuid NOT NULL REFERENCES client(id),
  contractor_id         uuid NOT NULL REFERENCES contractor(id),
  fy_id                 uuid NOT NULL REFERENCES financial_year(id),
  location              text,
  notes                 text,
  latitude              numeric,
  longitude             numeric,
  geo_address           text,
  optimo_stop_id        text,
  crew_id               uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  cancelled_at          timestamptz,
  cancelled_by          uuid REFERENCES profiles(id),
  cancellation_reason   text
);
CREATE INDEX idx_booking_client ON booking(client_id);
CREATE INDEX idx_booking_contractor ON booking(contractor_id);
CREATE INDEX idx_booking_collection_area ON booking(collection_area_id);
CREATE INDEX idx_booking_property ON booking(property_id);
CREATE INDEX idx_booking_contact ON booking(contact_id);
CREATE INDEX idx_booking_status ON booking(status);
CREATE INDEX idx_booking_ref ON booking(ref);
CREATE TRIGGER booking_updated_at BEFORE UPDATE ON booking
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE booking_item (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id           uuid NOT NULL REFERENCES booking(id) ON DELETE CASCADE,
  service_type_id      uuid NOT NULL REFERENCES service_type(id),
  collection_date_id   uuid NOT NULL REFERENCES collection_date(id),
  no_services          integer NOT NULL DEFAULT 1,
  actual_services      integer,
  unit_price_cents     integer NOT NULL DEFAULT 0,
  is_extra             boolean NOT NULL DEFAULT false,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_booking_item_booking ON booking_item(booking_id);
CREATE INDEX idx_booking_item_collection_date ON booking_item(collection_date_id);
CREATE TRIGGER booking_item_updated_at BEFORE UPDATE ON booking_item
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE booking_payment (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            uuid NOT NULL REFERENCES booking(id) ON DELETE CASCADE,
  client_id             uuid NOT NULL REFERENCES client(id),
  contractor_id         uuid NOT NULL REFERENCES contractor(id),
  stripe_session_id     text NOT NULL UNIQUE,
  stripe_payment_intent text,
  stripe_charge_id      text,
  amount_cents          integer NOT NULL,
  currency              text NOT NULL DEFAULT 'aud',
  status                text NOT NULL DEFAULT 'pending',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER booking_payment_updated_at BEFORE UPDATE ON booking_payment
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE refund_request (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id        uuid NOT NULL REFERENCES booking(id),
  contact_id        uuid NOT NULL REFERENCES contacts(id),
  client_id         uuid NOT NULL REFERENCES client(id),
  amount_cents      integer NOT NULL,
  reason            text NOT NULL DEFAULT '',
  status            text NOT NULL DEFAULT 'Pending',
  stripe_refund_id  text,
  reviewed_by       uuid REFERENCES profiles(id),
  reviewed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER refund_request_updated_at BEFORE UPDATE ON refund_request
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();


-- ------------------------------------------------------------
-- INCIDENTS
-- ------------------------------------------------------------

CREATE TABLE non_conformance_notice (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id              uuid NOT NULL REFERENCES booking(id),
  client_id               uuid NOT NULL REFERENCES client(id),
  reason                  ncn_reason NOT NULL,
  notes                   text,
  photos                  text[] NOT NULL DEFAULT '{}',
  status                  ncn_status NOT NULL DEFAULT 'Open',
  reported_by             uuid REFERENCES profiles(id),
  reported_at             timestamptz NOT NULL DEFAULT now(),
  resolved_by             uuid REFERENCES profiles(id),
  resolved_at             timestamptz,
  resolution_notes        text,
  rescheduled_booking_id  uuid REFERENCES booking(id),
  rescheduled_date        date,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER ncn_updated_at BEFORE UPDATE ON non_conformance_notice
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE nothing_presented (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id              uuid NOT NULL REFERENCES booking(id),
  client_id               uuid NOT NULL REFERENCES client(id),
  notes                   text,
  photos                  text[] NOT NULL DEFAULT '{}',
  status                  np_status NOT NULL DEFAULT 'Open',
  dm_fault                boolean NOT NULL DEFAULT false,
  reported_by             uuid REFERENCES profiles(id),
  reported_at             timestamptz NOT NULL DEFAULT now(),
  resolved_by             uuid REFERENCES profiles(id),
  resolved_at             timestamptz,
  resolution_notes        text,
  rescheduled_booking_id  uuid REFERENCES booking(id),
  rescheduled_date        date,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER np_updated_at BEFORE UPDATE ON nothing_presented
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();


-- ------------------------------------------------------------
-- SERVICE TICKETS
-- ------------------------------------------------------------

CREATE TABLE service_ticket (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_id        text NOT NULL UNIQUE,
  client_id         uuid NOT NULL REFERENCES client(id),
  booking_id        uuid REFERENCES booking(id),
  contact_id        uuid NOT NULL REFERENCES contacts(id),
  subject           text NOT NULL,
  message           text NOT NULL,
  status            ticket_status NOT NULL DEFAULT 'open',
  priority          ticket_priority NOT NULL DEFAULT 'normal',
  category          ticket_category NOT NULL DEFAULT 'general',
  channel           ticket_channel NOT NULL DEFAULT 'portal',
  assigned_to       uuid REFERENCES profiles(id),
  first_response_at timestamptz,
  resolved_at       timestamptz,
  closed_at         timestamptz,
  attio_record_id   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_service_ticket_client ON service_ticket(client_id);
CREATE INDEX idx_service_ticket_contact ON service_ticket(contact_id);
CREATE TRIGGER service_ticket_updated_at BEFORE UPDATE ON service_ticket
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE ticket_response (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    uuid NOT NULL REFERENCES service_ticket(id) ON DELETE CASCADE,
  author_id    uuid NOT NULL REFERENCES profiles(id),
  author_type  text NOT NULL,
  message      text NOT NULL,
  is_internal  boolean NOT NULL DEFAULT false,
  channel      text NOT NULL DEFAULT 'portal',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER ticket_response_updated_at BEFORE UPDATE ON ticket_response
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE sla_config (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES client(id),
  priority              ticket_priority NOT NULL,
  first_response_hours  integer NOT NULL DEFAULT 24,
  resolution_hours      integer NOT NULL DEFAULT 72,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, priority)
);
CREATE TRIGGER sla_config_updated_at BEFORE UPDATE ON sla_config
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();


-- ------------------------------------------------------------
-- NOTIFICATIONS & SURVEYS
-- ------------------------------------------------------------

CREATE TABLE notification_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            uuid REFERENCES booking(id),
  contact_id            uuid REFERENCES contacts(id),
  client_id             uuid NOT NULL REFERENCES client(id),
  channel               text NOT NULL,
  notification_type     text NOT NULL,
  to_address            text NOT NULL,
  status                text NOT NULL DEFAULT 'sent',
  error_message         text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notification_log_booking ON notification_log(booking_id);

CREATE TABLE booking_survey (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid NOT NULL UNIQUE REFERENCES booking(id),
  client_id    uuid NOT NULL REFERENCES client(id),
  token        text NOT NULL UNIQUE,
  submitted_at timestamptz,
  responses    jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_booking_survey_token ON booking_survey(token);

CREATE TABLE client_survey_config (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES client(id) ON DELETE CASCADE,
  questions   jsonb NOT NULL DEFAULT '[]',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id)
);
CREATE TRIGGER client_survey_config_updated_at BEFORE UPDATE ON client_survey_config
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();


-- ------------------------------------------------------------
-- PERMISSIONS
-- ------------------------------------------------------------

CREATE TABLE app_module (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  app         text NOT NULL,
  category    text NOT NULL,
  icon        text,
  route       text,
  sort_order  integer NOT NULL DEFAULT 0
);

CREATE TABLE role_permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role        app_role NOT NULL,
  module_id   text NOT NULL REFERENCES app_module(id),
  action      app_permission_action NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role, module_id, action)
);
CREATE TRIGGER role_permissions_updated_at BEFORE UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();


-- ------------------------------------------------------------
-- AUDIT & LOGGING
-- ------------------------------------------------------------

CREATE TABLE audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name     text NOT NULL,
  record_id      uuid NOT NULL,
  action         text NOT NULL,
  old_data       jsonb,
  new_data       jsonb,
  changed_by     uuid REFERENCES profiles(id),
  client_id      uuid REFERENCES client(id),
  contractor_id  uuid REFERENCES contractor(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_record ON audit_log(table_name, record_id);
CREATE INDEX idx_audit_log_client ON audit_log(client_id);

CREATE TABLE bug_report (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_id            text NOT NULL UNIQUE,
  title                 text NOT NULL,
  source_app            text NOT NULL,
  category              bug_report_category NOT NULL DEFAULT 'other',
  priority              bug_report_priority NOT NULL DEFAULT 'medium',
  status                bug_report_status NOT NULL DEFAULT 'new',
  reporter_id           uuid NOT NULL REFERENCES profiles(id),
  assigned_to           uuid REFERENCES profiles(id),
  client_id             uuid REFERENCES client(id),
  collection_area_id    uuid REFERENCES collection_area(id),
  page_url              text,
  browser_info          text,
  linear_issue_id       text,
  linear_issue_url      text,
  resolved_at           timestamptz,
  resolution_notes      text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER bug_report_updated_at BEFORE UPDATE ON bug_report
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE sync_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type      text NOT NULL,
  entity_id        uuid NOT NULL,
  direction        text NOT NULL,
  attio_record_id  text,
  status           text NOT NULL DEFAULT 'success',
  error_message    text,
  payload          jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);


-- ------------------------------------------------------------
-- BOOKING STATE MACHINE TRIGGER
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_booking_state_transition()
RETURNS TRIGGER AS $$
DECLARE
  valid boolean := false;
BEGIN
  valid := CASE
    WHEN OLD.status = 'Pending Payment'   AND NEW.status = 'Submitted'          THEN true
    WHEN OLD.status = 'Pending Payment'   AND NEW.status = 'Cancelled'           THEN true
    WHEN OLD.status = 'Submitted'         AND NEW.status = 'Confirmed'           THEN true
    WHEN OLD.status = 'Submitted'         AND NEW.status = 'Cancelled'           THEN true
    WHEN OLD.status = 'Confirmed'         AND NEW.status = 'Scheduled'           THEN true
    WHEN OLD.status = 'Confirmed'         AND NEW.status = 'Cancelled'           THEN true
    WHEN OLD.status = 'Scheduled'         AND NEW.status = 'Completed'           THEN true
    WHEN OLD.status = 'Scheduled'         AND NEW.status = 'Non-conformance'     THEN true
    WHEN OLD.status = 'Scheduled'         AND NEW.status = 'Nothing Presented'   THEN true
    WHEN OLD.status = 'Scheduled'         AND NEW.status = 'Cancelled'           THEN true
    WHEN OLD.status = 'Non-conformance'   AND NEW.status = 'Rebooked'            THEN true
    WHEN OLD.status = 'Nothing Presented' AND NEW.status = 'Rebooked'            THEN true
    ELSE false
  END;

  IF NOT valid THEN
    RAISE EXCEPTION 'Invalid booking status transition: % → %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_state_machine
  BEFORE UPDATE OF status ON booking
  FOR EACH ROW
  EXECUTE FUNCTION enforce_booking_state_transition();


-- ------------------------------------------------------------
-- CANCELLATION CUTOFF TRIGGER
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_cancellation_cutoff()
RETURNS TRIGGER AS $$
DECLARE
  v_collection_date date;
  v_cutoff timestamptz;
BEGIN
  IF NEW.status = 'Cancelled' AND OLD.status NOT IN ('Pending Payment', 'Submitted') THEN
    SELECT MIN(cd.date) INTO v_collection_date
    FROM booking_item bi
    JOIN collection_date cd ON cd.id = bi.collection_date_id
    WHERE bi.booking_id = NEW.id;

    -- 3:30pm AWST = 07:30 UTC
    v_cutoff := (v_collection_date - interval '1 day')::timestamptz
                + interval '7 hours 30 minutes';

    IF now() > v_cutoff THEN
      RAISE EXCEPTION 'Cancellation cutoff has passed for booking %', NEW.ref;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_cancellation_cutoff
  BEFORE UPDATE OF status ON booking
  FOR EACH ROW
  EXECUTE FUNCTION enforce_cancellation_cutoff();


-- ------------------------------------------------------------
-- CAPACITY RECALCULATION TRIGGER
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION recalculate_collection_date_units()
RETURNS TRIGGER AS $$
DECLARE
  v_date_id uuid;
BEGIN
  v_date_id := COALESCE(NEW.collection_date_id, OLD.collection_date_id);

  UPDATE collection_date cd
  SET
    bulk_units_booked = (
      SELECT COALESCE(SUM(bi.no_services), 0)
      FROM booking_item bi
      JOIN booking b ON b.id = bi.booking_id
      JOIN service_type st ON st.id = bi.service_type_id
      JOIN category c ON c.id = st.category_id
      WHERE bi.collection_date_id = v_date_id
      AND c.capacity_bucket = 'bulk'
      AND b.status NOT IN ('Cancelled', 'Pending Payment')
    ),
    anc_units_booked = (
      SELECT COALESCE(SUM(bi.no_services), 0)
      FROM booking_item bi
      JOIN booking b ON b.id = bi.booking_id
      JOIN service_type st ON st.id = bi.service_type_id
      JOIN category c ON c.id = st.category_id
      WHERE bi.collection_date_id = v_date_id
      AND c.capacity_bucket = 'anc'
      AND b.status NOT IN ('Cancelled', 'Pending Payment')
    ),
    id_units_booked = (
      SELECT COALESCE(SUM(bi.no_services), 0)
      FROM booking_item bi
      JOIN booking b ON b.id = bi.booking_id
      JOIN service_type st ON st.id = bi.service_type_id
      JOIN category c ON c.id = st.category_id
      WHERE bi.collection_date_id = v_date_id
      AND c.capacity_bucket = 'id'
      AND b.status NOT IN ('Cancelled', 'Pending Payment')
    )
  WHERE cd.id = v_date_id;

  UPDATE collection_date
  SET
    bulk_is_closed = (bulk_units_booked >= bulk_capacity_limit),
    anc_is_closed  = (anc_units_booked >= anc_capacity_limit),
    id_is_closed   = (id_units_booked >= id_capacity_limit)
  WHERE id = v_date_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER recalculate_units
  AFTER INSERT OR UPDATE OR DELETE ON booking_item
  FOR EACH ROW EXECUTE FUNCTION recalculate_collection_date_units();


-- ------------------------------------------------------------
-- SURVEY CREATION TRIGGER
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_survey_on_completion()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'Completed' AND OLD.status != 'Completed' THEN
    INSERT INTO booking_survey (booking_id, client_id, token)
    VALUES (
      NEW.id,
      NEW.client_id,
      encode(gen_random_bytes(32), 'hex')
    )
    ON CONFLICT (booking_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_survey_on_completion
  AFTER UPDATE OF status ON booking
  FOR EACH ROW
  EXECUTE FUNCTION create_survey_on_completion();


-- ------------------------------------------------------------
-- RESIDENT ROLE ASSIGNMENT ON SIGNUP
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION assign_resident_role_on_signup()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);

  INSERT INTO public.user_roles (user_id, role, client_id)
  VALUES (
    NEW.id,
    'resident',
    (NEW.raw_user_meta_data->>'client_id')::uuid
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION assign_resident_role_on_signup();


-- ------------------------------------------------------------
-- RLS HELPER FUNCTIONS
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS app_role AS $$
  SELECT role FROM user_roles WHERE user_id = auth.uid() AND is_active = true LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION current_user_contractor_id()
RETURNS uuid AS $$
  SELECT contractor_id FROM user_roles WHERE user_id = auth.uid() AND is_active = true LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION current_user_client_id()
RETURNS uuid AS $$
  SELECT client_id FROM user_roles WHERE user_id = auth.uid() AND is_active = true LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION current_user_contact_id()
RETURNS uuid AS $$
  SELECT contact_id FROM profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION has_role(check_role app_role)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = auth.uid() AND role = check_role AND is_active = true
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_contractor_user()
RETURNS boolean AS $$
  SELECT current_user_role() IN ('contractor-admin', 'contractor-staff', 'field');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_client_staff()
RETURNS boolean AS $$
  SELECT current_user_role() IN ('client-admin', 'client-staff');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION is_field_user()
RETURNS boolean AS $$
  SELECT current_user_role() IN ('field', 'ranger');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION accessible_client_ids()
RETURNS SETOF uuid AS $$
  SELECT CASE
    WHEN is_contractor_user() THEN
      (SELECT id FROM client WHERE contractor_id = current_user_contractor_id())
    ELSE
      current_user_client_id()
  END;
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ------------------------------------------------------------
-- ENABLE RLS ON ALL TABLES
-- ------------------------------------------------------------

ALTER TABLE contractor              ENABLE ROW LEVEL SECURITY;
ALTER TABLE client                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_client              ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_area         ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE category                ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_type            ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_year          ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_rules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_rules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE eligible_properties     ENABLE ROW LEVEL SECURITY;
ALTER TABLE strata_user_properties  ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_date         ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_item            ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_payment         ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_request          ENABLE ROW LEVEL SECURITY;
ALTER TABLE non_conformance_notice  ENABLE ROW LEVEL SECURITY;
ALTER TABLE nothing_presented       ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_ticket          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_response         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_config              ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_survey          ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_survey_config    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_module              ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log               ENABLE ROW LEVEL SECURITY;
ALTER TABLE bug_report              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log                ENABLE ROW LEVEL SECURITY;


-- ------------------------------------------------------------
-- RLS POLICIES
-- ------------------------------------------------------------

-- PROFILES: Users see own profile
CREATE POLICY profiles_select ON profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY profiles_update ON profiles FOR UPDATE
  USING (id = auth.uid());

-- USER_ROLES: Users see own role
CREATE POLICY user_roles_select ON user_roles FOR SELECT
  USING (user_id = auth.uid());

-- CATEGORY & SERVICE_TYPE: All authenticated users can read
CREATE POLICY category_select ON category FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY service_type_select ON service_type FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- FINANCIAL_YEAR: All authenticated users can read
CREATE POLICY financial_year_select ON financial_year FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- CONTRACTOR: Contractor users see own contractor
CREATE POLICY contractor_select ON contractor FOR SELECT
  USING (
    id = current_user_contractor_id()
    OR is_contractor_user()
  );

-- CLIENT: Users see clients they have access to
CREATE POLICY client_select ON client FOR SELECT
  USING (id IN (SELECT accessible_client_ids()));

-- SUB_CLIENT: Users see sub-clients under accessible clients
CREATE POLICY sub_client_select ON sub_client FOR SELECT
  USING (client_id IN (SELECT accessible_client_ids()));

-- COLLECTION_AREA: Users see areas under accessible clients
CREATE POLICY collection_area_select ON collection_area FOR SELECT
  USING (client_id IN (SELECT accessible_client_ids()));

-- CONTACTS: Residents see own, staff see tenant contacts
CREATE POLICY contacts_resident_select ON contacts FOR SELECT
  USING (
    id = current_user_contact_id()
    AND current_user_role() = 'resident'
  );

CREATE POLICY contacts_contractor_select ON contacts FOR SELECT
  USING (
    is_contractor_user()
    AND EXISTS (
      SELECT 1 FROM booking b
      WHERE b.contact_id = contacts.id
      AND b.contractor_id = current_user_contractor_id()
    )
  );

CREATE POLICY contacts_client_staff_select ON contacts FOR SELECT
  USING (
    is_client_staff()
    AND EXISTS (
      SELECT 1 FROM booking b
      WHERE b.contact_id = contacts.id
      AND b.client_id = current_user_client_id()
    )
  );

-- ELIGIBLE_PROPERTIES: All authenticated users in accessible clients
CREATE POLICY eligible_properties_select ON eligible_properties FOR SELECT
  USING (
    collection_area_id IN (
      SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids())
    )
  );

-- STRATA_USER_PROPERTIES: Strata users see own properties
CREATE POLICY strata_user_properties_select ON strata_user_properties FOR SELECT
  USING (user_id = auth.uid());

-- COLLECTION_DATE: Users see dates for accessible clients
CREATE POLICY collection_date_select ON collection_date FOR SELECT
  USING (
    collection_area_id IN (
      SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids())
    )
  );

CREATE POLICY collection_date_contractor_write ON collection_date FOR ALL
  USING (has_role('contractor-admin'))
  WITH CHECK (has_role('contractor-admin'));

-- ALLOCATION_RULES & SERVICE_RULES: All authenticated users can read
CREATE POLICY allocation_rules_select ON allocation_rules FOR SELECT
  USING (
    collection_area_id IN (
      SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids())
    )
  );

CREATE POLICY service_rules_select ON service_rules FOR SELECT
  USING (
    collection_area_id IN (
      SELECT id FROM collection_area WHERE client_id IN (SELECT accessible_client_ids())
    )
  );

-- BOOKING: Role-based access
CREATE POLICY booking_resident_select ON booking FOR SELECT
  USING (
    contact_id = current_user_contact_id()
    AND current_user_role() IN ('resident', 'strata')
  );

CREATE POLICY booking_contractor_select ON booking FOR SELECT
  USING (
    contractor_id = current_user_contractor_id()
    AND is_contractor_user()
  );

CREATE POLICY booking_client_staff_select ON booking FOR SELECT
  USING (
    client_id = current_user_client_id()
    AND is_client_staff()
  );

CREATE POLICY booking_field_select ON booking FOR SELECT
  USING (
    client_id IN (SELECT accessible_client_ids())
    AND is_field_user()
  );

CREATE POLICY booking_resident_insert ON booking FOR INSERT
  WITH CHECK (
    current_user_role() IN ('resident', 'strata')
    AND contact_id = current_user_contact_id()
  );

CREATE POLICY booking_resident_update ON booking FOR UPDATE
  USING (
    contact_id = current_user_contact_id()
    AND status NOT IN ('Scheduled', 'Completed', 'Cancelled')
  );

CREATE POLICY booking_staff_update ON booking FOR UPDATE
  USING (
    client_id IN (SELECT accessible_client_ids())
    AND (is_client_staff() OR is_contractor_user())
  );

CREATE POLICY booking_field_update ON booking FOR UPDATE
  USING (
    client_id IN (SELECT accessible_client_ids())
    AND has_role('field')
    AND status = 'Scheduled'
  )
  WITH CHECK (
    status IN ('Completed', 'Non-conformance', 'Nothing Presented')
  );

-- BOOKING_ITEM: Follows booking access
CREATE POLICY booking_item_select ON booking_item FOR SELECT
  USING (
    booking_id IN (SELECT id FROM booking)
  );

-- NCN: Role-based access
CREATE POLICY ncn_resident_select ON non_conformance_notice FOR SELECT
  USING (
    booking_id IN (
      SELECT id FROM booking WHERE contact_id = current_user_contact_id()
    )
  );

CREATE POLICY ncn_staff_select ON non_conformance_notice FOR SELECT
  USING (
    client_id IN (SELECT accessible_client_ids())
    AND (is_client_staff() OR is_contractor_user() OR is_field_user())
  );

CREATE POLICY ncn_field_insert ON non_conformance_notice FOR INSERT
  WITH CHECK (
    client_id IN (SELECT accessible_client_ids())
    AND has_role('field')
  );

-- NOTHING PRESENTED: Same pattern as NCN
CREATE POLICY np_resident_select ON nothing_presented FOR SELECT
  USING (
    booking_id IN (
      SELECT id FROM booking WHERE contact_id = current_user_contact_id()
    )
  );

CREATE POLICY np_staff_select ON nothing_presented FOR SELECT
  USING (
    client_id IN (SELECT accessible_client_ids())
    AND (is_client_staff() OR is_contractor_user() OR is_field_user())
  );

CREATE POLICY np_field_insert ON nothing_presented FOR INSERT
  WITH CHECK (
    client_id IN (SELECT accessible_client_ids())
    AND has_role('field')
  );

-- SERVICE TICKET: Role-based access
CREATE POLICY service_ticket_resident_select ON service_ticket FOR SELECT
  USING (
    contact_id = current_user_contact_id()
    AND current_user_role() = 'resident'
  );

CREATE POLICY service_ticket_staff_select ON service_ticket FOR SELECT
  USING (
    client_id IN (SELECT accessible_client_ids())
    AND (is_client_staff() OR is_contractor_user())
  );

-- TICKET_RESPONSE: Non-internal visible to residents
CREATE POLICY ticket_response_resident_select ON ticket_response FOR SELECT
  USING (
    is_internal = false
    AND ticket_id IN (
      SELECT id FROM service_ticket WHERE contact_id = current_user_contact_id()
    )
  );

CREATE POLICY ticket_response_staff_select ON ticket_response FOR SELECT
  USING (
    ticket_id IN (
      SELECT id FROM service_ticket
      WHERE client_id IN (SELECT accessible_client_ids())
    )
    AND (is_client_staff() OR is_contractor_user())
  );

-- BOOKING_SURVEY: Token-based public access handled in API route
CREATE POLICY booking_survey_resident_select ON booking_survey FOR SELECT
  USING (
    booking_id IN (
      SELECT id FROM booking WHERE contact_id = current_user_contact_id()
    )
  );

-- AUDIT_LOG: Admin read only
CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (
    client_id IN (SELECT accessible_client_ids())
    AND (has_role('client-admin') OR has_role('contractor-admin'))
  );

-- APP_MODULE & ROLE_PERMISSIONS: All authenticated users can read
CREATE POLICY app_module_select ON app_module FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY role_permissions_select ON role_permissions FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- BUG_REPORT: Users can insert and see own reports
CREATE POLICY bug_report_insert ON bug_report FOR INSERT
  WITH CHECK (reporter_id = auth.uid());

CREATE POLICY bug_report_select ON bug_report FOR SELECT
  USING (
    reporter_id = auth.uid()
    OR client_id IN (SELECT accessible_client_ids())
  );

-- NOTIFICATION_LOG: Staff read only
CREATE POLICY notification_log_select ON notification_log FOR SELECT
  USING (
    client_id IN (SELECT accessible_client_ids())
    AND (is_client_staff() OR is_contractor_user())
  );

-- SLA_CONFIG: Staff read
CREATE POLICY sla_config_select ON sla_config FOR SELECT
  USING (client_id IN (SELECT accessible_client_ids()));

-- CLIENT_SURVEY_CONFIG: Staff read
CREATE POLICY client_survey_config_select ON client_survey_config FOR SELECT
  USING (client_id IN (SELECT accessible_client_ids()));