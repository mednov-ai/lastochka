ALTER TABLE enrollment_requests
    ADD COLUMN weekly_series_id uuid,
    ADD COLUMN weekly_revision bigint,
    ADD CONSTRAINT enrollment_weekly_preference_check CHECK (
        (weekly_series_id IS NULL AND weekly_revision IS NULL) OR
        (weekly_series_id IS NOT NULL AND weekly_revision IS NOT NULL AND weekly_revision > 0 AND
         age_direction_id IS NOT NULL AND desired_session_id IS NULL AND desired_session_snapshot IS NOT NULL)
    );
