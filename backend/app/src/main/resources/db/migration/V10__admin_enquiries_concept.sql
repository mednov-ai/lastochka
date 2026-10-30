-- Explicitly authorized removal of ordinary accounts and their family/booking data.
-- Deployment requires a tested pre-migration backup; administrators/schedule remain.
CREATE TABLE concept_state (id integer PRIMARY KEY CHECK(id=1), mode varchar(40) NOT NULL, switched_at timestamptz NOT NULL DEFAULT now());
INSERT INTO concept_state(id,mode) VALUES(1,'ADMIN_ENQUIRIES_V1');
DELETE FROM spring_session;
DELETE FROM webauthn_challenges;
DELETE FROM auth_tokens;
DELETE FROM move_previews;
DELETE FROM idempotency_records;
DELETE FROM attendance_contexts;
UPDATE notification_outbox SET grant_hash=NULL;
DELETE FROM attendance_grants;
DELETE FROM notification_outbox WHERE recipient IN(SELECT email FROM accounts WHERE role='PARENT')
 OR aggregate_id IN(SELECT id FROM bookings WHERE parent_id IN(SELECT id FROM accounts WHERE role='PARENT'));
UPDATE notification_outbox SET status='SKIPPED', body='', encrypted_payload=NULL, lease_until=NULL WHERE status<>'CAPTURED';
DELETE FROM audit_events WHERE aggregate_id IN(SELECT id FROM bookings WHERE parent_id IN(SELECT id FROM accounts WHERE role='PARENT'))
 OR aggregate_id IN(SELECT id FROM children WHERE parent_id IN(SELECT id FROM accounts WHERE role='PARENT'));
DELETE FROM bookings WHERE parent_id IN(SELECT id FROM accounts WHERE role='PARENT') OR child_id IN(SELECT id FROM children WHERE parent_id IN(SELECT id FROM accounts WHERE role='PARENT'));
DELETE FROM children WHERE parent_id IN(SELECT id FROM accounts WHERE role='PARENT');
DELETE FROM user_credentials WHERE user_entity_user_id IN(SELECT id FROM user_entities WHERE name IN(SELECT email FROM accounts WHERE role='PARENT'));
DELETE FROM user_entities WHERE name IN(SELECT email FROM accounts WHERE role='PARENT');
UPDATE audit_events SET actor_id=NULL WHERE actor_id IN(SELECT id FROM accounts WHERE role='PARENT');
DELETE FROM accounts WHERE role='PARENT';
ALTER TABLE accounts ADD COLUMN login varchar(64) UNIQUE;
ALTER TABLE accounts ADD COLUMN admin_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE accounts ADD CONSTRAINT accounts_admin_only CHECK(role='ADMIN');
ALTER TABLE accounts ADD CONSTRAINT accounts_login_format CHECK(login IS NULL OR login ~ '^[a-z0-9._-]{3,64}$');
ALTER TABLE accounts ADD CONSTRAINT accounts_enabled_login CHECK(NOT admin_enabled OR login IS NOT NULL);
UPDATE accounts SET additional_role=NULL, auth_version=auth_version+1;
CREATE TABLE enrollment_requests (
 id uuid PRIMARY KEY, public_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 parent_name varchar(100) NOT NULL, phone varchar(12) NOT NULL, child_name varchar(100) NOT NULL,
 child_age integer NOT NULL CHECK(child_age BETWEEN 0 AND 17), desired_session_id uuid REFERENCES studio_sessions(id),
 desired_session_snapshot text, comment varchar(1000), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enquiries_order ON enrollment_requests(created_at DESC,id DESC);
CREATE TABLE enquiry_replays (key uuid PRIMARY KEY, request_hash varchar(64) NOT NULL, enquiry_id uuid NOT NULL REFERENCES enrollment_requests(id), expires_at timestamptz NOT NULL);
CREATE TABLE telegram_outbox (
 enquiry_id uuid PRIMARY KEY REFERENCES enrollment_requests(id), body text NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'PENDING', attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz,
 message_id bigint, last_error varchar(60), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX telegram_pending ON telegram_outbox(status,next_attempt_at);
CREATE TABLE payment_requests (
 id uuid PRIMARY KEY, amount_minor bigint NOT NULL CHECK(amount_minor>0 AND amount_minor<=99999999),
 purpose varchar(300) NOT NULL, recipient_name varchar(100) NOT NULL, phone varchar(12) NOT NULL,
 enquiry_id uuid REFERENCES enrollment_requests(id), version bigint NOT NULL DEFAULT 0,
 created_by uuid NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
