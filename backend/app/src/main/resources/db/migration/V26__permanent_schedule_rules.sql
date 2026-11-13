-- Existing finite series and their occurrences remain unchanged. A permanent series
-- has the same identity as session_series and keeps its published rule revisions here.
CREATE TABLE permanent_series (
 series_id uuid PRIMARY KEY REFERENCES session_series(id),
 revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

-- A revision applies from effective_from, inclusive, to effective_until, exclusive.
-- The command service must hold the studio lock and reject overlapping revisions.
CREATE TABLE permanent_series_revisions (
 series_id uuid NOT NULL REFERENCES permanent_series(series_id),
 revision bigint NOT NULL CHECK (revision > 0),
 effective_from date NOT NULL,
 effective_until date,
 weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
 start_time time NOT NULL,
 duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 1 AND 10079),
 direction_id uuid NOT NULL REFERENCES age_directions(id),
 title varchar(120) NOT NULL CHECK (length(btrim(title)) > 0),
 capacity integer NOT NULL CHECK (capacity > 0),
 age_from integer NOT NULL CHECK (age_from BETWEEN 0 AND 120),
 age_to integer,
 age_open_ended boolean NOT NULL,
 superseded boolean NOT NULL DEFAULT false,
 PRIMARY KEY (series_id, revision),
 CHECK (effective_until IS NULL OR effective_until > effective_from),
 CHECK ((age_open_ended AND age_to IS NULL) OR
        (NOT age_open_ended AND age_to IS NOT NULL AND age_to BETWEEN age_from AND 120))
);
-- Superseded future revisions remain in history but no longer determine occurrences.
CREATE UNIQUE INDEX permanent_series_effective_start_idx
 ON permanent_series_revisions(series_id, effective_from) WHERE NOT superseded;
CREATE INDEX permanent_series_revisions_period_idx
 ON permanent_series_revisions(effective_from, effective_until, weekday);
