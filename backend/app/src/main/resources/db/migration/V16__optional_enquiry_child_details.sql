-- Existing child details remain unchanged; new enquiries can omit them.
ALTER TABLE enrollment_requests ALTER COLUMN child_name DROP NOT NULL;
ALTER TABLE enrollment_requests ALTER COLUMN child_age DROP NOT NULL;
