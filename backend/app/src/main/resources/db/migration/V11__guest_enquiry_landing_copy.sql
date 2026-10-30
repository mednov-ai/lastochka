-- Replace only exact obsolete default instructions, preserving unrelated/custom content.
WITH revised AS (
 SELECT id, payload AS old_payload,
  jsonb_set(payload, '{blocks}', (
   SELECT jsonb_agg(
    CASE WHEN jsonb_typeof(block->'items')='array' THEN
     jsonb_set(block, '{items}', COALESCE((
      SELECT jsonb_agg(CASE item #>> '{}' 
       WHEN 'Оставьте заявку|Создайте аккаунт родителя и добавьте ребёнка.' THEN to_jsonb('Оставьте заявку|Укажите имя и телефон родителя, имя и возраст ребёнка. Администратор свяжется с вами.'::text)
       WHEN 'Выберите занятие|Посмотрите свободное время в расписании.' THEN to_jsonb('Выберите желаемое занятие|Посмотрите опубликованные занятия в расписании.'::text)
       WHEN 'Дождитесь подтверждения|Администратор подтвердит запись. Возьмите удобную форму и воду.' THEN to_jsonb('Согласуйте занятие|Администратор свяжется с вами и согласует время. Отправка заявки не резервирует место.'::text)
       WHEN 'Можно записать двоих детей?|Да. Добавьте карточки детей в кабинете и отправьте отдельную заявку для каждого.' THEN to_jsonb('Можно записать двоих детей?|Да. Отправьте отдельную заявку для каждого ребёнка. Администратор свяжется с вами и согласует занятия.'::text)
       WHEN 'Когда запись считается подтверждённой?|После одобрения администратором. Статус заявки виден в кабинете.' THEN to_jsonb('Когда запись считается подтверждённой?|После личного согласования с администратором. Отправка заявки сама по себе не резервирует место.'::text)
       ELSE item END ORDER BY item_order)
      FROM jsonb_array_elements(block->'items') WITH ORDINALITY AS items(item,item_order)
     ), '[]'::jsonb))
    ELSE block END ORDER BY block_order)
   FROM jsonb_array_elements(payload->'blocks') WITH ORDINALITY AS blocks(block,block_order)
  )) AS new_payload
 FROM landing_content
)
UPDATE landing_content AS content
SET revision=content.revision+1,
 payload=jsonb_set(revised.new_payload,'{revision}',to_jsonb(content.revision+1)), updated_at=now()
FROM revised
WHERE content.id=revised.id AND revised.new_payload IS DISTINCT FROM revised.old_payload;
