-- Flyway runs this entire cutover in one transaction. DROP uses RESTRICT.
SET LOCAL TIME ZONE 'UTC';
LOCK TABLE studio_sessions, session_edit_drafts, session_group_links, schedule_groups,
 session_series, permanent_series, permanent_series_revisions, enrollment_requests IN ACCESS EXCLUSIVE MODE;

DO $$
DECLARE
 fingerprint text;
 today date := (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date;
BEGIN
 -- Bind the destructive cutover to the exact set reviewed on the restored copy.
 SELECT md5(string_agg(to_jsonb(s)::text, E'\n' ORDER BY id)) INTO fingerprint FROM studio_sessions s;
 IF fingerprint IS NOT NULL AND fingerprint IS DISTINCT FROM current_setting('lastochka.reviewed_calendar', true) THEN
   RAISE EXCEPTION 'Dated calendar has not been reviewed or has changed since review';
 END IF;
 IF EXISTS (SELECT FROM pg_constraint WHERE contype='f'
     AND confrelid IN ('studio_sessions'::regclass,'session_series'::regclass,'schedule_groups'::regclass,
         'session_edit_drafts'::regclass,'session_group_links'::regclass,'permanent_series'::regclass,
         'permanent_series_revisions'::regclass)
     AND conrelid NOT IN ('session_series'::regclass,'session_group_links'::regclass,'session_edit_drafts'::regclass,
         'permanent_series'::regclass,'permanent_series_revisions'::regclass)
     AND NOT (conrelid='enrollment_requests'::regclass AND conname='enrollment_requests_desired_session_id_fkey'))
 THEN RAISE EXCEPTION 'Unreviewed dependency on dated calendar'; END IF;
 IF EXISTS (SELECT FROM session_edit_drafts)
 OR EXISTS (SELECT FROM session_series s LEFT JOIN permanent_series p ON p.series_id=s.id
            WHERE p.series_id IS NULL OR s.draft IS NOT NULL)
 OR EXISTS (SELECT FROM schedule_groups g WHERE NOT EXISTS (SELECT FROM session_series s WHERE s.group_id=g.id))
 OR EXISTS (SELECT FROM permanent_series_revisions WHERE NOT superseded AND
            (effective_from > today OR effective_until > today OR extract(second from start_time) <> 0))
 THEN RAISE EXCEPTION 'Review outstanding drafts, finite groups or scheduled rule changes before cutover'; END IF;
END $$;

CREATE TABLE weekly_intervals (
 id uuid PRIMARY KEY,
 revision bigint NOT NULL CHECK (revision > 0),
 direction_id uuid NOT NULL REFERENCES age_directions(id),
 weekday integer NOT NULL CHECK (weekday BETWEEN 1 AND 7),
 start_minute integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
 duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 1 AND 10079)
);
CREATE SEQUENCE weekly_interval_revision;
SELECT setval('weekly_interval_revision', greatest(
 coalesce((SELECT max(revision) FROM permanent_series_revisions),0),
 coalesce((SELECT max(weekly_revision) FROM enrollment_requests),0)
) + 1, false);
INSERT INTO weekly_intervals
 SELECT series_id, revision, direction_id, weekday,
        extract(epoch FROM start_time)::int / 60, duration_minutes
 FROM permanent_series_revisions
 WHERE NOT superseded AND effective_from <= (now() AT TIME ZONE 'Europe/Moscow')::date AND effective_until IS NULL;
-- A single studio, including intervals crossing midnight on Sunday.
ALTER TABLE weekly_intervals ADD CONSTRAINT weekly_intervals_no_overlap EXCLUDE USING gist
 ( (int4multirange(int4range((weekday-1)*1440+start_minute, least(10080,(weekday-1)*1440+start_minute+duration_minutes)),
                   int4range(0,greatest(0,(weekday-1)*1440+start_minute+duration_minutes-10080)))) WITH && );

-- Check the exact retained request fields inside the transaction as well as
-- comparing protected tables on the restored copy. No personal data leaves PostgreSQL.
CREATE TEMP TABLE weekly_request_check ON COMMIT DROP AS
 SELECT id, md5((to_jsonb(e) - 'desired_session_id' - 'desired_session_snapshot')::text) AS retained,
        desired_session_snapshot AS snapshot, desired_session_id AS original_id
 FROM enrollment_requests e;

-- Preserve the original relation and missing-snapshot source in the existing audit trail.
INSERT INTO audit_events(aggregate_id, action, occurred_at, before_state)
 SELECT e.id, 'DATED_ENQUIRY_MIGRATED', now(), jsonb_build_object('sessionId', s.id,
   'session',to_jsonb(s),'snapshot',e.desired_session_snapshot)
 FROM enrollment_requests e JOIN studio_sessions s ON e.desired_session_id=s.id;

-- Preserve the readable published snapshot verbatim when it exists. For older
-- linked requests without one, retain the original identity, local times and group.
UPDATE enrollment_requests e SET desired_session_snapshot = format('%s · %s–%s МСК · %s · %s',
 s.title, to_char(s.starts_at AT TIME ZONE 'Europe/Moscow','DD.MM.YYYY HH24:MI'),
 to_char(s.ends_at AT TIME ZONE 'Europe/Moscow','DD.MM.YYYY HH24:MI'),
 CASE WHEN s.format='GROUP' THEN 'группа' ELSE 'индивидуально' END, s.id)
 FROM studio_sessions s WHERE e.desired_session_id=s.id AND nullif(btrim(e.desired_session_snapshot),'') IS NULL;
ALTER TABLE enrollment_requests DROP CONSTRAINT enrollment_weekly_preference_check,
 DROP COLUMN desired_session_id;
ALTER TABLE enrollment_requests ADD CONSTRAINT enrollment_weekly_preference_check CHECK (
 (weekly_series_id IS NULL AND weekly_revision IS NULL) OR
 (weekly_series_id IS NOT NULL AND weekly_revision IS NOT NULL AND weekly_revision>0
  AND age_direction_id IS NOT NULL AND desired_session_snapshot IS NOT NULL));

DROP TABLE session_edit_drafts, session_group_links, permanent_series_revisions, permanent_series,
 session_series, schedule_groups, studio_sessions;
DROP SEQUENCE recurrence_draft_revision, session_draft_revision;

DO $$
BEGIN
 IF EXISTS (SELECT FROM weekly_request_check b FULL JOIN enrollment_requests e USING (id)
   WHERE b.id IS NULL OR e.id IS NULL
      OR b.retained <> md5((to_jsonb(e) - 'desired_session_snapshot')::text)
      OR CASE WHEN b.original_id IS NOT NULL AND nullif(btrim(b.snapshot),'') IS NULL
              THEN nullif(btrim(e.desired_session_snapshot),'') IS NULL
              ELSE b.snapshot IS DISTINCT FROM e.desired_session_snapshot END
      OR (b.original_id IS NOT NULL AND NOT EXISTS (
          SELECT FROM audit_events a WHERE a.aggregate_id=b.id AND a.action='DATED_ENQUIRY_MIGRATED'
            AND a.before_state->>'sessionId'=b.original_id::text)))
 THEN RAISE EXCEPTION 'Historical enquiry verification failed'; END IF;
END $$;
