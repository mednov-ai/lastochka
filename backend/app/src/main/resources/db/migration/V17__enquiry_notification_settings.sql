CREATE TABLE enquiry_notification_settings (
 id integer PRIMARY KEY CHECK (id=1),
 telegram_enabled boolean NOT NULL DEFAULT true,
 browser_push_enabled boolean NOT NULL DEFAULT false,
 version bigint NOT NULL DEFAULT 0
);
INSERT INTO enquiry_notification_settings(id) VALUES(1);
