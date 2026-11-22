CREATE TABLE vk_enquiry_settings (
    id integer PRIMARY KEY CHECK (id = 1),
    version bigint NOT NULL DEFAULT 0,
    enabled boolean NOT NULL DEFAULT false,
    active_token bytea,
    active_group bigint,
    active_peer bigint,
    active_title text,
    destination_id uuid,
    draft_token bytea,
    draft_group bigint,
    draft_peer bigint,
    draft_title text,
    test_status varchar(20),
    test_error varchar(60),
    test_started timestamptz,
    test_random_id integer,
    CHECK (NOT enabled OR destination_id IS NOT NULL)
);
INSERT INTO vk_enquiry_settings (id) VALUES (1);

CREATE SEQUENCE vk_enquiry_random_id_seq AS integer MINVALUE 1 MAXVALUE 1073741823;

CREATE TABLE vk_enquiry_outbox (
    enquiry_id uuid PRIMARY KEY REFERENCES enrollment_requests(id),
    destination_id uuid NOT NULL,
    enquiry_number bigint NOT NULL,
    random_id integer NOT NULL UNIQUE CHECK (random_id > 0),
    status varchar(20) NOT NULL DEFAULT 'PENDING',
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_until timestamptz,
    message_id bigint,
    last_error varchar(60),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vk_enquiry_pending ON vk_enquiry_outbox(destination_id, next_attempt_at, created_at)
    WHERE status IN ('PENDING', 'RETRY_WAIT');
