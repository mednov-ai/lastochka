ALTER TABLE alfa_credentials_versions
    ADD COLUMN environment VARCHAR(16) NOT NULL DEFAULT 'TEST'
    CHECK (environment IN ('TEST', 'PRODUCTION'));
ALTER TABLE alfa_credentials_versions
    ADD CONSTRAINT uq_alfa_credentials_id_environment UNIQUE (id, environment);

ALTER TABLE alfa_configuration DROP CONSTRAINT alfa_configuration_id_check;
ALTER TABLE alfa_configuration
    ADD COLUMN environment VARCHAR(16) NOT NULL DEFAULT 'TEST';
ALTER TABLE alfa_configuration
    ADD CONSTRAINT ck_alfa_config_identity CHECK (
        (id = 1 AND environment = 'TEST') OR (id = 2 AND environment = 'PRODUCTION')
    ),
    ADD CONSTRAINT uq_alfa_config_environment UNIQUE (environment),
    ADD CONSTRAINT fk_alfa_config_active_environment FOREIGN KEY (active_version, environment)
        REFERENCES alfa_credentials_versions(id, environment),
    ADD CONSTRAINT fk_alfa_config_candidate_environment FOREIGN KEY (candidate_version, environment)
        REFERENCES alfa_credentials_versions(id, environment);
INSERT INTO alfa_configuration (id, environment) VALUES (2, 'PRODUCTION');

ALTER TABLE alfa_test_attempts
    ADD COLUMN environment VARCHAR(16) NOT NULL DEFAULT 'TEST'
    CHECK (environment IN ('TEST', 'PRODUCTION'));
ALTER TABLE alfa_test_attempts
    ADD CONSTRAINT fk_alfa_attempt_environment FOREIGN KEY (config_version, environment)
        REFERENCES alfa_credentials_versions(id, environment);

-- No gateway is selected automatically, even if an older test configuration was active.
CREATE TABLE alfa_gateway_selection (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    active_environment VARCHAR(16) CHECK (active_environment IN ('TEST', 'PRODUCTION')),
    revision BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ,
    updated_by UUID REFERENCES accounts(id)
);
INSERT INTO alfa_gateway_selection (id) VALUES (1);

CREATE FUNCTION alfa_prevent_attempt_identity_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.payment_id IS DISTINCT FROM OLD.payment_id OR NEW.environment IS DISTINCT FROM OLD.environment
       OR NEW.config_version IS DISTINCT FROM OLD.config_version OR NEW.order_number IS DISTINCT FROM OLD.order_number
       OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor OR NEW.currency IS DISTINCT FROM OLD.currency
       OR NEW.purpose IS DISTINCT FROM OLD.purpose OR NEW.draft_version IS DISTINCT FROM OLD.draft_version THEN
        RAISE EXCEPTION 'Alfa attempt identity is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_alfa_attempt_identity_immutable
    BEFORE UPDATE ON alfa_test_attempts FOR EACH ROW EXECUTE FUNCTION alfa_prevent_attempt_identity_change();

CREATE FUNCTION alfa_prevent_credential_environment_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.environment IS DISTINCT FROM OLD.environment THEN
        RAISE EXCEPTION 'Alfa credential identity is immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trg_alfa_credential_environment_immutable
    BEFORE UPDATE ON alfa_credentials_versions FOR EACH ROW EXECUTE FUNCTION alfa_prevent_credential_environment_change();
