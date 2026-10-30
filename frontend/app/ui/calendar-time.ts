const dateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' });
export const timeLabel = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  hour: '2-digit',
  minute: '2-digit',
});
export const dayLabel = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  weekday: 'short',
  day: 'numeric',
  month: 'long',
});
export const dateKey = (value: Date | string) => dateFormatter.format(new Date(value));
export const dayStart = (date: string) => new Date(date + 'T00:00:00+03:00');
export const addDays = (date: string, count: number) =>
  dateKey(new Date(dayStart(date).valueOf() + count * 86400000));
export const monday = (date: string) =>
  addDays(date, -((new Date(date + 'T12:00:00+03:00').getUTCDay() + 6) % 7));
export const inputTime = (value: string) =>
  new Date(new Date(value).valueOf() + 3 * 3600000).toISOString().slice(0, 16);
export const instant = (value: FormDataEntryValue | null) =>
  new Date(String(value) + ':00+03:00').toISOString();
