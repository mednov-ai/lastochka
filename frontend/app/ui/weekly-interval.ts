import type { components } from '../api/schema';

export type WeeklyInterval = components['schemas']['WeeklyInterval'];
export type WeeklySchedule = components['schemas']['WeeklySchedule'];
export const weekdays = [
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
  'Воскресенье',
];

export function weeklyChoice({ seriesId, revision }: WeeklyInterval['reference']) {
  return `weekly|${seriesId}|${revision}`;
}

export function readWeeklyChoice(choice: string): WeeklyInterval['reference'] | undefined {
  const match =
    /^weekly\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|([1-9]\d*)$/i.exec(
      choice,
    );
  if (match && Number.isSafeInteger(Number(match[2])))
    return { seriesId: match[1], revision: Number(match[2]) };
}

export function weeklyTime(interval: WeeklyInterval) {
  const format = (minute: number) =>
    [Math.floor(minute / 60) % 24, minute % 60].map((n) => String(n).padStart(2, '0')).join(':');
  const end = interval.startMinute + interval.durationMinutes;
  const days = Math.floor(end / 1440);
  return `${format(interval.startMinute)}–${format(end)}${days ? ` (+${days} дн.)` : ''}`;
}
