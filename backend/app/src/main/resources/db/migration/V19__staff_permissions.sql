-- Existing administrators retain their role, credentials and sessions.
ALTER TABLE accounts DROP CONSTRAINT accounts_admin_only;
ALTER TABLE accounts DROP CONSTRAINT accounts_role_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_supported_roles CHECK (role IN ('ADMIN', 'STAFF'));
ALTER TABLE accounts ADD COLUMN permission_revision bigint NOT NULL DEFAULT 0;

CREATE TABLE staff_permissions (
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    permission varchar(32) NOT NULL CHECK (permission IN (
        'SCHEDULE_VIEW', 'SCHEDULE_EDIT', 'PAYMENT_VIEW', 'PAYMENT_EDIT', 'ENQUIRIES_VIEW'
    )),
    PRIMARY KEY (account_id, permission)
);
