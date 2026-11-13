-- A separate dictionary: existing groups, sessions and enquiry snapshots are untouched.
CREATE TABLE IF NOT EXISTS age_directions (
 id uuid PRIMARY KEY,
 title varchar(100) NOT NULL CHECK (length(btrim(title)) > 0),
 description text NOT NULL DEFAULT '',
 age_from integer NOT NULL CHECK (age_from BETWEEN 0 AND 120),
 age_to integer,
 age_open_ended boolean NOT NULL DEFAULT false,
 active boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL DEFAULT 0,
 version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
 CHECK ((age_open_ended AND age_to IS NULL) OR
        (NOT age_open_ended AND age_to IS NOT NULL AND age_to BETWEEN age_from AND 120))
);

-- Stable identifiers make repeated initialization safe without replacing edits.
INSERT INTO age_directions(id, title, description, age_from, age_to, age_open_ended, sort_order)
VALUES
 ('b8c0a000-0000-4000-8000-000000000001', '3–5 лет', 'Через игру развиваем координацию и моторику, знакомимся с движением и радуемся первым успехам.', 3, 5, false, 10),
 ('b8c0a000-0000-4000-8000-000000000002', '6–7 лет', 'Занимаемся физкультурой в увлекательной форме, развиваем ловкость и уверенность в движениях.', 6, 7, false, 20),
 ('b8c0a000-0000-4000-8000-000000000003', '8–9 лет', 'Укрепляем тело, осваиваем технику упражнений и учимся верить в свои силы.', 8, 9, false, 30),
 ('b8c0a000-0000-4000-8000-000000000004', '10–13 лет', 'Совершенствуем технику, развиваем выносливость и силу, учимся двигаться увереннее.', 10, 13, false, 40),
 ('b8c0a000-0000-4000-8000-000000000005', '14+ лет', 'Занятия для подростков и взрослых с разным уровнем подготовки: развиваем силу, гибкость и физическую форму.', 14, NULL, true, 50)
ON CONFLICT (id) DO NOTHING;

-- Existing series stay unassigned; membership must never be inferred from labels.
ALTER TABLE session_series ADD COLUMN IF NOT EXISTS age_direction_id uuid REFERENCES age_directions(id);
CREATE INDEX IF NOT EXISTS session_series_age_direction_idx ON session_series(age_direction_id);
