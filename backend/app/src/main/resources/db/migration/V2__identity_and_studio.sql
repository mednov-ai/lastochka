CREATE TABLE accounts (
 id uuid PRIMARY KEY, email varchar(254) UNIQUE NOT NULL, name varchar(120) NOT NULL,
 password_hash varchar(255) NOT NULL, role varchar(20) NOT NULL CHECK(role IN ('PARENT','ADMIN')),
 verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(email = lower(trim(email)))
);
CREATE TABLE auth_tokens (
 hash varchar(64) PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id),
 kind varchar(10) NOT NULL CHECK(kind IN ('VERIFY','RESET')), expires_at timestamptz NOT NULL
);
CREATE TABLE auth_limits (bucket varchar(300) PRIMARY KEY, attempts int NOT NULL, resets_at timestamptz NOT NULL);
CREATE TABLE user_entities (id varchar(500) PRIMARY KEY, name varchar(254) NOT NULL UNIQUE REFERENCES accounts(email), display_name varchar(254) NOT NULL);
CREATE TABLE user_credentials (
 credential_id varchar(1024) PRIMARY KEY, user_entity_user_id varchar(500) NOT NULL REFERENCES user_entities(id),
 public_key bytea NOT NULL, signature_count bigint NOT NULL, uv_initialized boolean NOT NULL,
 backup_eligible boolean NOT NULL, authenticator_transports varchar(1000) NOT NULL,
 public_key_credential_type varchar(100) NOT NULL, backup_state boolean NOT NULL,
 attestation_object bytea, attestation_client_data_json bytea, created timestamp NOT NULL,
 last_used timestamp NOT NULL, label varchar(120) NOT NULL
);
CREATE INDEX user_credentials_user_idx ON user_credentials(user_entity_user_id);
CREATE TABLE webauthn_challenges (
 session_id varchar(100) PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id),
 kind varchar(10) NOT NULL, payload text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE children (
 id uuid PRIMARY KEY, parent_id uuid NOT NULL REFERENCES accounts(id), name varchar(120) NOT NULL,
 birth_date date NOT NULL CHECK(birth_date <= CURRENT_DATE), archived_at timestamptz, version bigint NOT NULL DEFAULT 0
);
CREATE INDEX children_parent_idx ON children(parent_id);
CREATE TABLE studio_settings (id integer PRIMARY KEY CHECK(id=1), trainer varchar(120) NOT NULL, room varchar(120) NOT NULL, zone varchar(50) NOT NULL);
INSERT INTO studio_settings VALUES (1, 'Паргев Арутюнян', 'Зал студии', 'Europe/Moscow');
CREATE TABLE studio_sessions (
 id uuid PRIMARY KEY, title varchar(120) NOT NULL, format varchar(20) NOT NULL CHECK(format IN ('GROUP','INDIVIDUAL')),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, capacity int NOT NULL CHECK(capacity>0),
 status varchar(20) NOT NULL CHECK(status IN ('DRAFT','OPEN','CLOSED','CANCELLED')), version bigint NOT NULL DEFAULT 0,
 CHECK(ends_at>starts_at), CHECK(format!='INDIVIDUAL' OR capacity=1)
);
CREATE INDEX studio_sessions_start_idx ON studio_sessions(starts_at,id);
CREATE TABLE bookings (
 id uuid PRIMARY KEY, child_id uuid NOT NULL REFERENCES children(id), session_id uuid NOT NULL REFERENCES studio_sessions(id),
 status varchar(20) NOT NULL CHECK(status IN ('PENDING','CONFIRMED','REJECTED','CANCELLED','EXPIRED')),
 version bigint NOT NULL DEFAULT 0, created_by uuid NOT NULL REFERENCES accounts(id), reason varchar(500),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX bookings_active_child_session ON bookings(child_id,session_id) WHERE status IN ('PENDING','CONFIRMED');
CREATE INDEX bookings_session_idx ON bookings(session_id,status);
CREATE TABLE audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, aggregate_id uuid NOT NULL,
 actor_id uuid REFERENCES accounts(id), action varchar(80) NOT NULL, occurred_at timestamptz NOT NULL,
 before_state jsonb, after_state jsonb, reason varchar(500)
);
CREATE TABLE idempotency_records (
 actor_id uuid NOT NULL REFERENCES accounts(id), operation varchar(160) NOT NULL, key varchar(100) NOT NULL,
 request_hash varchar(64) NOT NULL, response text NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(actor_id,operation,key)
);
CREATE TABLE landing_content (id int PRIMARY KEY CHECK(id=1), schema_version int NOT NULL, revision bigint NOT NULL, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE notification_outbox (
 event_id uuid PRIMARY KEY, sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 aggregate_id uuid NOT NULL, recipient varchar(254) NOT NULL, subject varchar(240) NOT NULL, body text NOT NULL,
 status varchar(20) NOT NULL DEFAULT 'PENDING', attempts int NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz,
 accepted_at timestamptz, last_error varchar(100), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON notification_outbox(status,next_attempt_at,sequence);
