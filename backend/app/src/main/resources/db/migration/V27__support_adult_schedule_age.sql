-- Widen the range without rewriting any existing session or its history. Legacy
-- commands still validate against their original range; adult permanent rules
-- are usable only behind the permanent-schedule compatibility guard.
ALTER TABLE studio_sessions DROP CONSTRAINT session_age_range;
ALTER TABLE studio_sessions ADD CONSTRAINT session_age_range CHECK (
 (age_from IS NULL AND age_to IS NULL) OR
 (age_from IS NOT NULL AND age_from BETWEEN 0 AND 120 AND
   (age_to IS NULL OR age_to BETWEEN age_from AND 120))
);
