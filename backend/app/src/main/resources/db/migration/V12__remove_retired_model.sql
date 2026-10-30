-- Explicit destructive boundary: refuse unexpected retained data or dependencies.
DO $$
DECLARE table_name text; has_rows boolean;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['children','bookings','auth_tokens','notification_outbox','attendance_grants','attendance_contexts','move_previews'] LOOP
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I)',table_name) INTO has_rows;
  IF has_rows THEN RAISE EXCEPTION 'Retired table % contains unexpected data; inspect and archive before migration', table_name; END IF;
 END LOOP;
END $$;
DROP TABLE attendance_contexts;
DROP TABLE notification_outbox;
DROP TABLE attendance_grants;
DROP TABLE move_previews;
DROP TABLE bookings;
DROP TABLE children;
DROP TABLE auth_tokens;
