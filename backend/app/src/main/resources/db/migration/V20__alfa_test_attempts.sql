-- Separate TEST-only attempts; existing draft data and versions are untouched.
CREATE TABLE alfa_test_attempts (
 payment_id uuid PRIMARY KEY REFERENCES payment_requests(id),
 config_version uuid NOT NULL,
 order_number varchar(64) NOT NULL UNIQUE,
 order_id varchar(128),
 draft_version bigint NOT NULL,
 amount_minor bigint NOT NULL CHECK (amount_minor > 0),
 currency varchar(3) NOT NULL DEFAULT 'RUB',
 purpose varchar(300) NOT NULL,
 operation_state varchar(32) NOT NULL,
 bank_status varchar(32),
 bank_checked_at timestamptz,
 bank_error varchar(64),
 link_ciphertext bytea,
 archived boolean NOT NULL DEFAULT false,
 rejected_at timestamptz,
 cancel_requested boolean NOT NULL DEFAULT false,
 callback_pending boolean NOT NULL DEFAULT false,
 revision bigint NOT NULL DEFAULT 0,
 lease_until timestamptz,
 next_check_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alfa_test_attempts_pending ON alfa_test_attempts(next_check_at)
 WHERE operation_state NOT IN ('PAID', 'CANCELLED');
CREATE INDEX alfa_test_attempts_archive ON alfa_test_attempts(archived, rejected_at);

CREATE TABLE alfa_test_callback_events (
 signature_hash char(64) PRIMARY KEY,
 payment_id uuid NOT NULL REFERENCES alfa_test_attempts(payment_id),
 created_at timestamptz NOT NULL DEFAULT now()
);
