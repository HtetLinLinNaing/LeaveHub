-- LeaveHub — Mixed per-day durations, emergency contact, MC upload
-- Adds a child table for per-day durations and optional contact / MC
-- metadata to leave_requests. Existing columns stay populated so
-- approval, balance, calendar, dashboard, and list views keep working
-- without code changes.

-- Per-day duration enum. Splits the old "half_day" into morning/evening
-- for the UI. Existing rows keep their stored value.
CREATE TYPE day_duration AS ENUM ('full_day', 'half_day_morning', 'half_day_evening');

-- One row per working day in the request. Drives the mixed-duration
-- total and lets the UI render the breakdown. Working days are decided
-- at insert time by the server action (see lib/actions.ts).
CREATE TABLE leave_request_days (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request_id UUID NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  duration day_duration NOT NULL DEFAULT 'full_day',
  units NUMERIC(3,1) NOT NULL DEFAULT 1.0 CHECK (units > 0 AND units <= 1),
  UNIQUE (leave_request_id, date)
);

CREATE INDEX idx_leave_request_days_request ON leave_request_days(leave_request_id);
CREATE INDEX idx_leave_request_days_date ON leave_request_days(date);

-- Optional emergency contact (all three fields together or all NULL).
ALTER TABLE leave_requests
  ADD COLUMN emergency_contact_name TEXT,
  ADD COLUMN emergency_contact_phone TEXT,
  ADD COLUMN emergency_contact_relationship TEXT,
  ADD CONSTRAINT leave_requests_emergency_contact_check
    CHECK (
      (emergency_contact_name IS NULL
        AND emergency_contact_phone IS NULL
        AND emergency_contact_relationship IS NULL)
      OR
      (emergency_contact_name IS NOT NULL
        AND emergency_contact_phone IS NOT NULL
        AND emergency_contact_relationship IS NOT NULL)
    );

-- Optional MC upload metadata. Path is the storage object key; name is
-- the original filename for display. Validation (type + size) is enforced
-- server-side on upload.
ALTER TABLE leave_requests
  ADD COLUMN mc_file_path TEXT,
  ADD COLUMN mc_file_name TEXT,
  ADD COLUMN mc_uploaded_at TIMESTAMPTZ,
  ADD CONSTRAINT leave_requests_mc_check
    CHECK (
      mc_file_path IS NULL
      OR (mc_file_path IS NOT NULL AND mc_file_name IS NOT NULL AND mc_uploaded_at IS NOT NULL)
    );

ALTER TABLE leave_request_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dev_allow_all_leave_request_days" ON leave_request_days FOR ALL USING (auth.uid() IS NULL);
