import { expect, test } from '@playwright/test';
import { directionFor, posterRows, type PosterDirection } from '../app/ui/schedule-poster-rows';
import type { ScheduleEntry } from '../app/ui/schedule-occurrence';

const direction = (id: string, ageFrom: number, ageTo: number | null): PosterDirection => ({
  id,
  title: ageTo === null ? `${ageFrom}+ лет` : `${ageFrom}–${ageTo} лет`,
  ageFrom,
  ageTo,
  ageOpenEnded: ageTo === null,
});
const directions = [
  direction('a', 3, 5),
  direction('b', 6, 7),
  direction('c', 8, 9),
  direction('d', 10, 13),
  direction('e', 14, null),
];
let counter = 0;
const entry = (
  ageFrom: number | null,
  ageTo: number | null,
  startsAt = '2080-01-01T14:00:00Z',
  open = false,
): ScheduleEntry => ({
  key: `session:${++counter}`,
  startsAt,
  status: 'OPEN',
  sessionId: String(counter),
  sessionVersion: 1,
  rule: null,
  summary: {
    title: 'Занятие',
    format: ageFrom === null ? 'INDIVIDUAL' : 'GROUP',
    capacity: 8,
    startsAt,
    endsAt: new Date(new Date(startsAt).valueOf() + 3600000).toISOString(),
    ageFrom,
    ageTo,
    ageOpenEnded: open,
  },
});

test('точный диапазон попадает в своё направление', () => {
  expect(directionFor(entry(8, 9), directions)?.id).toBe('c');
  expect(directionFor(entry(14, null, undefined, true), directions)?.id).toBe('e');
});

test('пересечение двух направлений даёт одну строку — первую по справочнику', () => {
  expect(directionFor(entry(7, 8), directions)?.id).toBe('b');
  expect(directionFor(entry(12, null, undefined, true), directions)?.id).toBe('d');
  const rows = posterRows([entry(7, 8)], directions);
  expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(1);
});

test('занятие без возраста и вне диапазонов идёт в отдельную строку', () => {
  const rows = posterRows([entry(null, null), entry(1, 2), entry(3, 5)], directions);
  expect(rows.at(-1)).toMatchObject({ key: 'other', direction: null, count: 2 });
  expect(rows.find((row) => row.key === 'a')?.count).toBe(1);
});

test('строка без направления не создаётся без занятий, порядок справочника сохраняется', () => {
  const rows = posterRows([], directions);
  expect(rows.map((row) => row.key)).toEqual(['a', 'b', 'c', 'd', 'e']);
});

test('более двадцати занятий распределены полностью и упорядочены по времени в ячейке', () => {
  const entries = Array.from({ length: 26 }, (_, index) =>
    entry(3, 5, `2080-01-01T${String(20 - (index % 12)).padStart(2, '0')}:00:00Z`),
  );
  const rows = posterRows(entries, directions);
  const cell = rows[0].days.get('2080-01-01')!;
  expect(rows[0].count).toBe(26);
  expect(cell).toHaveLength(26);
  expect(cell.map((item) => item.startsAt)).toEqual([...cell.map((item) => item.startsAt)].sort());
});
