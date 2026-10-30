ALTER TABLE studio_sessions ADD COLUMN age_from integer, ADD COLUMN age_to integer;
ALTER TABLE studio_sessions ADD CONSTRAINT session_age_range CHECK (
 (age_from IS NULL AND age_to IS NULL) OR
 (age_from IS NOT NULL AND age_to IS NOT NULL AND age_from >= 0 AND age_to <= 17 AND age_from <= age_to));
CREATE SEQUENCE session_draft_revision;
CREATE TABLE session_edit_drafts (
 session_id uuid PRIMARY KEY REFERENCES studio_sessions(id),
 version bigint NOT NULL DEFAULT nextval('session_draft_revision'),
 base_session_version bigint NOT NULL,
 payload jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES accounts(id),
 updated_at timestamptz NOT NULL
);
CREATE INDEX audit_events_aggregate_history_idx ON audit_events(aggregate_id, occurred_at DESC, id DESC);
