CREATE SEQUENCE recurrence_draft_revision;
CREATE TABLE schedule_groups (
 id uuid PRIMARY KEY, version bigint NOT NULL DEFAULT 0, parameters jsonb NOT NULL
);
CREATE TABLE session_series (
 id uuid PRIMARY KEY, group_id uuid NOT NULL REFERENCES schedule_groups(id),
 version bigint NOT NULL DEFAULT 0, rule jsonb,
 draft jsonb, draft_version bigint, draft_base_version bigint,
 CHECK ((draft IS NULL AND draft_version IS NULL AND draft_base_version IS NULL) OR
        (draft IS NOT NULL AND draft_version IS NOT NULL AND draft_base_version IS NOT NULL))
);
CREATE INDEX session_series_group_idx ON session_series(group_id,id);
CREATE TABLE session_group_links (
 session_id uuid PRIMARY KEY REFERENCES studio_sessions(id),
 group_id uuid NOT NULL REFERENCES schedule_groups(id),
 series_id uuid REFERENCES session_series(id), original_date date, is_exception boolean NOT NULL DEFAULT false,
 CHECK ((series_id IS NULL AND original_date IS NULL) OR (series_id IS NOT NULL AND original_date IS NOT NULL)),
 UNIQUE(series_id,original_date)
);
CREATE INDEX session_group_links_group_idx ON session_group_links(group_id,session_id);
CREATE TABLE recurrence_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 aggregate_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES accounts(id),
 occurred_at timestamptz NOT NULL DEFAULT now(), action varchar(64) NOT NULL,
 operation_id uuid NOT NULL, rule jsonb, affected integer NOT NULL DEFAULT 0
);
CREATE INDEX recurrence_history_aggregate_idx ON recurrence_history(aggregate_id,id DESC);
