ALTER TABLE bookings ADD COLUMN attendance_revision bigint NOT NULL DEFAULT 1;
ALTER TABLE bookings ADD COLUMN client_confirmed_at timestamptz;
ALTER TABLE bookings ADD COLUMN client_confirmed_revision bigint;
ALTER TABLE bookings ADD COLUMN invitation_issued_at timestamptz;

CREATE TABLE attendance_grants (
 hash varchar(64) PRIMARY KEY, booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
 parent_id uuid NOT NULL REFERENCES accounts(id), purpose varchar(40) NOT NULL CHECK(purpose='ATTENDANCE_CONFIRM'),
 revision bigint NOT NULL, email_hash varchar(64) NOT NULL, auth_version bigint NOT NULL,
 generation varchar(100) NOT NULL, event_id uuid NOT NULL UNIQUE,
 issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 consumed_at timestamptz, revoked_at timestamptz
);
CREATE INDEX attendance_grants_booking ON attendance_grants(booking_id, revision);
CREATE TABLE attendance_contexts (
 hash varchar(64) PRIMARY KEY, csrf_hash varchar(64) NOT NULL, view_nonce_hash varchar(64),
 grant_hash varchar(64) REFERENCES attendance_grants(hash) ON DELETE CASCADE,
 generation varchar(100) NOT NULL, issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX attendance_contexts_expiry ON attendance_contexts(expires_at);
CREATE UNIQUE INDEX attendance_response_once ON audit_events(aggregate_id, (after_state->>'attendanceRevision'))
 WHERE action='ATTENDANCE_CONFIRMED';
CREATE TABLE move_previews (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES accounts(id), kind varchar(20) NOT NULL,
 source_id uuid NOT NULL, payload text NOT NULL, fingerprint varchar(64) NOT NULL,
 generation varchar(100) NOT NULL, expires_at timestamptz NOT NULL, applied_at timestamptz
);
CREATE INDEX move_previews_expiry ON move_previews(expires_at);
ALTER TABLE notification_outbox ADD COLUMN encrypted_payload text;
ALTER TABLE notification_outbox ADD COLUMN payload_key_id varchar(80);
ALTER TABLE notification_outbox ADD COLUMN grant_hash varchar(64) REFERENCES attendance_grants(hash);
ALTER TABLE notification_outbox ADD COLUMN payload_expires_at timestamptz;
