ALTER TABLE accounts ADD COLUMN additional_role varchar(20);
ALTER TABLE accounts ADD CONSTRAINT accounts_additional_role_valid
 CHECK (additional_role IS NULL OR (additional_role='DOCTOR' AND role='ADMIN'));
