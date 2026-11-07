-- Test credentials are encrypted by the backend; no key or plaintext is stored here.
CREATE TABLE alfa_credentials_versions (
    id UUID PRIMARY KEY,
    ciphertext BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    created_by UUID NOT NULL REFERENCES accounts(id)
);

CREATE TABLE alfa_configuration (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    revision BIGINT NOT NULL DEFAULT 0,
    current_key_id VARCHAR(32),
    active_version UUID REFERENCES alfa_credentials_versions(id),
    candidate_version UUID REFERENCES alfa_credentials_versions(id),
    updated_at TIMESTAMPTZ,
    updated_by UUID REFERENCES accounts(id)
);

INSERT INTO alfa_configuration (id) VALUES (1);

ALTER TABLE alfa_test_attempts ADD CONSTRAINT fk_alfa_attempt_credentials
    FOREIGN KEY (config_version) REFERENCES alfa_credentials_versions(id);
