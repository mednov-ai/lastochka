DO $$
DECLARE
  current_payload jsonb;
  updated_payload jsonb;
  old_phone constant text := '+7 906 602-30-21';
  new_phone constant text := '+7 951 143-31-44';
  new_email constant text := 'Lastochka-gym@mail.ru';
BEGIN
  SELECT payload INTO current_payload FROM landing_content WHERE id = 1 FOR UPDATE;
  IF current_payload IS NULL THEN RETURN; END IF;
  updated_payload := current_payload;

  IF current_payload->>'phone' = old_phone THEN
    updated_payload := jsonb_set(updated_payload, '{phone}', to_jsonb(new_phone));
  ELSIF current_payload->>'phone' IS DISTINCT FROM new_phone THEN
    RAISE WARNING 'Landing contact conflict: published phone retained';
  END IF;

  IF current_payload->>'email' IS NULL THEN
    updated_payload := jsonb_set(updated_payload, '{email}', to_jsonb(new_email));
  ELSIF current_payload->>'email' IS DISTINCT FROM new_email THEN
    RAISE WARNING 'Landing contact conflict: published email retained';
  END IF;

  IF updated_payload IS DISTINCT FROM current_payload THEN
    UPDATE landing_content SET revision = revision + 1,
      payload = jsonb_set(updated_payload, '{revision}', to_jsonb(revision + 1)), updated_at = now()
      WHERE id = 1;
  END IF;
END $$;
