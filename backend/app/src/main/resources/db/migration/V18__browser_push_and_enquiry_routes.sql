CREATE TABLE browser_push_subscriptions (
 id uuid PRIMARY KEY,
 account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 endpoint_hash varchar(64) NOT NULL UNIQUE,
 endpoint text NOT NULL,
 p256dh varchar(128) NOT NULL,
 auth_secret varchar(128) NOT NULL,
 generation_hash varchar(64) NOT NULL,
 auth_version bigint NOT NULL,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX browser_push_owner ON browser_push_subscriptions(account_id);
CREATE TABLE enquiry_notification_routes (
 enquiry_id uuid PRIMARY KEY REFERENCES enrollment_requests(id),
 telegram_enabled boolean NOT NULL,
 browser_push_enabled boolean NOT NULL,
 push_subscriptions integer NOT NULL DEFAULT 0 CHECK(push_subscriptions >= 0)
);
INSERT INTO enquiry_notification_routes(enquiry_id,telegram_enabled,browser_push_enabled)
 SELECT id,true,false FROM enrollment_requests;
CREATE TABLE browser_push_outbox (
 enquiry_id uuid NOT NULL REFERENCES enrollment_requests(id),
 subscription_id uuid NOT NULL REFERENCES browser_push_subscriptions(id) ON DELETE CASCADE,
 status varchar(20) NOT NULL DEFAULT 'PENDING',
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(enquiry_id, subscription_id)
);
CREATE INDEX browser_push_pending ON browser_push_outbox(status,next_attempt_at);
