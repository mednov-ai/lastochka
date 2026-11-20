-- Additive: earlier enquiries keep NULL here and their previous participant fields.
-- The direction is copied as a snapshot because the dictionary stays editable.
ALTER TABLE enrollment_requests ADD COLUMN age_direction_id uuid REFERENCES age_directions(id);
ALTER TABLE enrollment_requests ADD COLUMN age_direction_title varchar(100);
ALTER TABLE enrollment_requests ADD COLUMN age_direction_from integer;
ALTER TABLE enrollment_requests ADD COLUMN age_direction_to integer;
ALTER TABLE enrollment_requests ADD COLUMN age_direction_open_ended boolean;
ALTER TABLE enrollment_requests ADD COLUMN participant_name varchar(100);

ALTER TABLE enrollment_requests ADD CONSTRAINT enrollment_age_direction_snapshot_check CHECK (
 (age_direction_id IS NULL AND age_direction_title IS NULL AND age_direction_from IS NULL
   AND age_direction_to IS NULL AND age_direction_open_ended IS NULL)
 OR
 (age_direction_id IS NOT NULL AND length(btrim(age_direction_title)) > 0
   AND age_direction_from BETWEEN 0 AND 120 AND age_direction_open_ended IS NOT NULL
   AND ((age_direction_open_ended AND age_direction_to IS NULL) OR
        (NOT age_direction_open_ended AND age_direction_to BETWEEN age_direction_from AND 120)))
);
