ALTER TABLE accounts
    ADD COLUMN must_change_password boolean NOT NULL DEFAULT false,
    ADD COLUMN temporary_password_expires_at timestamptz,
    ADD CONSTRAINT account_temporary_password_state CHECK (
        (must_change_password AND temporary_password_expires_at IS NOT NULL)
        OR (NOT must_change_password AND temporary_password_expires_at IS NULL)
    );
