ALTER TABLE studio_sessions DROP CONSTRAINT session_age_range;
ALTER TABLE studio_sessions ADD CONSTRAINT session_age_range CHECK (
 (age_from IS NULL AND age_to IS NULL) OR
 (age_from IS NOT NULL AND age_from BETWEEN 0 AND 17 AND
   (age_to IS NULL OR (age_to BETWEEN age_from AND 17)))
);
