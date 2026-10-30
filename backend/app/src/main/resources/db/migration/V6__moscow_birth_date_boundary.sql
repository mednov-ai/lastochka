ALTER TABLE children DROP CONSTRAINT children_birth_date_check;
ALTER TABLE children ADD CONSTRAINT children_birth_date_check CHECK(birth_date <= (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date);
