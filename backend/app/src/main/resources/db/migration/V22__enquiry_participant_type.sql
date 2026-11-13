-- Historical requests remain unclassified; no old participant data is rewritten.
ALTER TABLE enrollment_requests ADD COLUMN participant_type varchar(5);
ALTER TABLE enrollment_requests ADD COLUMN participant_age integer;
ALTER TABLE enrollment_requests ADD CONSTRAINT enrollment_participant_type_check
    CHECK (participant_type IS NULL OR participant_type IN ('CHILD', 'SELF'));
ALTER TABLE enrollment_requests ADD CONSTRAINT enrollment_participant_age_check
    CHECK (participant_age IS NULL OR participant_age BETWEEN 0 AND 120);
ALTER TABLE enrollment_requests ADD CONSTRAINT enrollment_participant_fields_check
    CHECK ((
      (participant_type IS NULL AND participant_age IS NULL)
      OR (participant_type = 'CHILD' AND participant_age IS NULL AND child_name IS NOT NULL AND child_age IS NOT NULL)
      OR (participant_type = 'SELF' AND participant_age IS NOT NULL AND child_name IS NULL AND child_age IS NULL)
    ) IS TRUE);
