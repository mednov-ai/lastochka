import { dateKey } from './calendar-time';
import type { ScheduleEntry } from './schedule-occurrence';

export type PosterDirection = {
  id: string;
  title: string;
  ageFrom: number;
  ageTo?: number | null;
  ageOpenEnded?: boolean | null;
};
export type PosterRow = {
  key: string;
  /** null marks the row for sessions that belong to no age direction. */
  direction: PosterDirection | null;
  days: Map<string, ScheduleEntry[]>;
  count: number;
};

const upper = (from: number, to?: number | null, open?: boolean | null) =>
  open ? Infinity : (to ?? from);

/**
 * Every session appears in exactly one row: the direction with the same age range, otherwise the
 * first direction whose range overlaps, otherwise the separate row without a direction.
 */
export function directionFor(entry: ScheduleEntry, directions: PosterDirection[]) {
  const { ageFrom, ageTo, ageOpenEnded } = entry.summary;
  if (ageFrom == null) return null;
  const to = upper(ageFrom, ageTo, ageOpenEnded);
  return (
    directions.find(
      (d) => d.ageFrom === ageFrom && upper(d.ageFrom, d.ageTo, d.ageOpenEnded) === to,
    ) ??
    directions.find(
      (d) => d.ageFrom <= to && upper(d.ageFrom, d.ageTo, d.ageOpenEnded) >= ageFrom,
    ) ??
    null
  );
}

/** Rows follow the catalogue order; the row without a direction exists only when it has sessions. */
export function posterRows(entries: ScheduleEntry[], directions: PosterDirection[]): PosterRow[] {
  const rows: PosterRow[] = directions.map((direction) => ({
    key: direction.id,
    direction,
    days: new Map(),
    count: 0,
  }));
  const other: PosterRow = { key: 'other', direction: null, days: new Map(), count: 0 };
  const sorted = [...entries].sort(
    (a, b) => new Date(a.startsAt).valueOf() - new Date(b.startsAt).valueOf(),
  );
  for (const entry of sorted) {
    const direction = directionFor(entry, directions);
    const row = (direction && rows.find((item) => item.key === direction.id)) || other;
    const day = dateKey(entry.startsAt);
    row.days.set(day, [...(row.days.get(day) ?? []), entry]);
    row.count++;
  }
  return other.count > 0 ? [...rows, other] : rows;
}
