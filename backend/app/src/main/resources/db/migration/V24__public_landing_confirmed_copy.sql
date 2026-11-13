-- Replace only known original wording. A custom value is retained and reported.
DO $$
DECLARE
  current_payload jsonb;
  updated_payload jsonb;
  blocks jsonb;
  block jsonb;
  idx integer;
  item_idx integer;
  old_text text;
  new_text text;
BEGIN
  SELECT payload INTO current_payload FROM landing_content WHERE id = 1 FOR UPDATE;
  IF current_payload IS NULL THEN RETURN; END IF;
  updated_payload := current_payload;

  old_text := 'Ласточка — детская оздоровительная гимнастика в Белгороде';
  new_text := 'Ласточка — оздоровительная гимнастика в Белгороде';
  IF current_payload->>'title' = old_text THEN
    updated_payload := jsonb_set(updated_payload, '{title}', to_jsonb(new_text));
  ELSIF current_payload->>'title' IS DISTINCT FROM new_text THEN
    RAISE WARNING 'Landing content conflict: title retained';
  END IF;

  old_text := 'Занятия для детей 5–14 лет: движение, координация и здоровые привычки. Мини-группы и индивидуальные занятия с Паргевом Арутюняном.';
  new_text := 'Оздоровительная гимнастика в Белгороде для детей от 3 лет, подростков и взрослых. Групповые и индивидуальные занятия.';
  IF current_payload->>'description' = old_text THEN
    updated_payload := jsonb_set(updated_payload, '{description}', to_jsonb(new_text));
  ELSIF current_payload->>'description' IS DISTINCT FROM new_text THEN
    RAISE WARNING 'Landing content conflict: description retained';
  END IF;

  blocks := updated_payload->'blocks';
  IF jsonb_typeof(blocks) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Unsupported landing content: blocks must be an array';
  END IF;
  FOR idx IN 0..jsonb_array_length(blocks)-1 LOOP
    block := blocks->idx;
    IF block->>'id' = 'hero' THEN
      old_text := 'Двигаться легко. Расти уверенно.';
      new_text := 'Гимнастика для детей и взрослых';
      IF block->>'title' = old_text THEN
        block := jsonb_set(block, '{title}', to_jsonb(new_text));
      ELSIF block->>'title' IS DISTINCT FROM new_text THEN
        RAISE WARNING 'Landing content conflict: hero title retained';
      END IF;
      old_text := 'Оздоровительная гимнастика для осанки, сильной спины и радости движения. В маленькой группе, с большим вниманием к каждому.';
      new_text := 'Движение, игра и упражнения в комфортном темпе. Подберём занятия по возрасту и уровню подготовки.';
      IF block->>'text' = old_text THEN
        block := jsonb_set(block, '{text}', to_jsonb(new_text));
      ELSIF block->>'text' IS DISTINCT FROM new_text THEN
        RAISE WARNING 'Landing content conflict: hero text retained';
      END IF;
      IF block->'items' = '["Белгород", "Дети 5–14 лет"]'::jsonb THEN
        block := jsonb_set(block, '{items}', '["Белгород", "Дети от 3 лет", "подростки и взрослые"]'::jsonb);
      ELSIF block->'items' IS DISTINCT FROM '["Белгород", "Дети от 3 лет", "подростки и взрослые"]'::jsonb THEN
        RAISE WARNING 'Landing content conflict: hero audience retained';
      END IF;
    ELSIF block->>'id' = 'faq' AND jsonb_typeof(block->'items') = 'array' THEN
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(block->'items') AS entry(value)
        WHERE value IN (
          'С какого возраста можно заниматься?|Программа студии рассчитана на детей 5–14 лет. Подходящий формат поможет выбрать тренер.',
          'С какого возраста можно заниматься?|В студии есть направления для детей от 3 лет, подростков и взрослых. Поможем подобрать подходящую группу.'
        )
      ) THEN
        RAISE WARNING 'Landing content conflict: FAQ age item retained';
      END IF;
      FOR item_idx IN 0..jsonb_array_length(block->'items')-1 LOOP
        old_text := 'С какого возраста можно заниматься?|Программа студии рассчитана на детей 5–14 лет. Подходящий формат поможет выбрать тренер.';
        new_text := 'С какого возраста можно заниматься?|В студии есть направления для детей от 3 лет, подростков и взрослых. Поможем подобрать подходящую группу.';
        IF block->'items'->>item_idx = old_text THEN
          block := jsonb_set(block, ARRAY['items', item_idx::text], to_jsonb(new_text));
        END IF;
      END LOOP;
    ELSIF block->>'id' = 'first-visit' AND jsonb_typeof(block->'items') = 'array' THEN
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(block->'items') AS entry(value)
        WHERE value IN (
          'Оставьте заявку|Укажите имя и телефон родителя, имя и возраст ребёнка. Администратор свяжется с вами.',
          'Оставьте заявку|Укажите имя, телефон и возраст участника. Администратор свяжется с вами.'
        )
      ) THEN
        RAISE WARNING 'Landing content conflict: first-visit enquiry item retained';
      END IF;
      FOR item_idx IN 0..jsonb_array_length(block->'items')-1 LOOP
        old_text := 'Оставьте заявку|Укажите имя и телефон родителя, имя и возраст ребёнка. Администратор свяжется с вами.';
        new_text := 'Оставьте заявку|Укажите имя, телефон и возраст участника. Администратор свяжется с вами.';
        IF block->'items'->>item_idx = old_text THEN
          block := jsonb_set(block, ARRAY['items', item_idx::text], to_jsonb(new_text));
        END IF;
      END LOOP;
    END IF;
    blocks := jsonb_set(blocks, ARRAY[idx::text], block);
  END LOOP;
  updated_payload := jsonb_set(updated_payload, '{blocks}', blocks);
  IF updated_payload IS DISTINCT FROM current_payload THEN
    UPDATE landing_content SET revision = revision + 1,
      payload = jsonb_set(updated_payload, '{revision}', to_jsonb(revision + 1)), updated_at = now()
      WHERE id = 1;
  END IF;
END $$;
