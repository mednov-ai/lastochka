import { api } from '../api/client';
import { entriesFromPage, type ScheduleEntry } from './schedule-occurrence';

/** Read every page before claiming a period or an age filter is complete. */
export async function loadScheduleProjection(from: string, to: string, admin = false): Promise<ScheduleEntry[]> {
  const items: ScheduleEntry[] = [];
  const seen = new Set<string>();
  let page = 0;
  let total: number | null = null;
  let snapshot: string | null = null;
  do {
    const options = { params: { query: { from, to, page, size: 100 } } };
    const response = admin
      ? await api.GET('/api/v1/admin/permanent-schedule/projection', options)
      : await api.GET('/api/v1/public/schedule', options);
    if (response.error) throw response.error;
    if (total !== null && response.data.total !== total)
      throw new Error('Расписание изменилось во время загрузки. Повторите загрузку.');
    total = response.data.total;
    if (total > 100 && (typeof response.data.snapshot !== 'string' || !response.data.snapshot ||
      (snapshot !== null && response.data.snapshot !== snapshot)))
      throw new Error('Расписание изменилось во время загрузки. Повторите загрузку.');
    if (page === 0 && typeof response.data.snapshot === 'string') snapshot = response.data.snapshot;
    if (total > 5000) throw new Error('Слишком много занятий за выбранный период.');
    for (const item of entriesFromPage(response.data, page, 100)) {
      if (seen.has(item.key)) throw new Error('Расписание изменилось во время загрузки. Повторите загрузку.');
      seen.add(item.key);
      items.push(item);
    }
    page++;
  } while (page * 100 < total);
  return items;
}
