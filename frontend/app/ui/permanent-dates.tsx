import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, csrf, message } from '../api/client';
import { appPath } from '../api/base-path';
import type { components } from '../api/schema';
import { dayLabel, dayStart, timeLabel } from './calendar-time';
import { entriesFromPage, type ScheduleEntry } from './schedule-occurrence';
import { editorCommands, editorRevision, subscribeEditorCommands } from './editor-commands';
import './permanent-schedule.css';
import { Pager } from './pager';

/** A calculated date becomes a real session only after an explicit admin command. */
export function PermanentDates({ from, to, revision, editable, onChanged, onOpen }: {
  from: string; to: string; revision: number; editable: boolean;
  onChanged: () => Promise<void>;
  onOpen: (session: components['schemas']['SessionView']) => void;
}) {
  const [items, setItems] = useState<ScheduleEntry[]>([]);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState('');
  const [page, setPage] = useState(0);
  const generation = useRef(0);
  useSyncExternalStore(subscribeEditorCommands, editorRevision, () => 0);
  const resource = appPath('/api/v1/admin/permanent-schedule');
  const pending = editorCommands().some((entry) => entry.resource === resource);
  useEffect(() => {
    const current = ++generation.current;
    setItems([]); setError(''); setPage(0);
    void (async () => {
      const result: ScheduleEntry[] = [];
      const seen = new Set<string>();
      let page = 0, total: number | null = null;
      do {
        const response = await api.GET('/api/v1/public/schedule', {
          params: { query: { from: dayStart(from).toISOString(), to: dayStart(to).toISOString(), page, size: 100 } },
        });
        if (response.error) throw response.error;
        if (total !== null && response.data.total !== total) throw new Error('Расписание изменилось во время загрузки.');
        total = response.data.total;
        if (total > 5000) throw new Error('Слишком много занятий за выбранный период.');
        for (const entry of entriesFromPage(response.data, page, 100)) {
          if (seen.has(entry.key)) throw new Error('Не удалось проверить расписание.');
          seen.add(entry.key);
          if (!entry.sessionId) result.push(entry);
        }
        page++;
      } while (page * 100 < total);
      if (current === generation.current) setItems(result);
    })().catch((err) => { if (current === generation.current) setError(message(err)); });
    return () => { generation.current++; };
  }, [from, to, revision]);
  async function open(entry: ScheduleEntry) {
    if (!entry.rule || opening || pending) return;
    setOpening(entry.key); setError('');
    const key = crypto.randomUUID();
    try {
      const response = await api.POST('/api/v1/admin/permanent-schedule/occurrence', {
        params: { header: { 'Idempotency-Key': key } },
        headers: { ...(await csrf()), 'Idempotency-Key': key },
        body: entry.rule,
      });
      if (response.error) throw response.error;
      await onChanged();
      onOpen(response.data);
    } catch (err) { setError(message(err)); }
    finally { setOpening(''); }
  }
  if (!items.length && !error) return null;
  return <section className="notice" aria-labelledby="permanent-dates-heading">
    <h2 id="permanent-dates-heading">Будущие занятия по расписанию</h2>
    {error ? <p role="alert">{error}</p> : null}
    <ul className="permanent-date-list">{items.slice(page * 20, page * 20 + 20).map((item) => <li key={item.key}>
      <span><strong>{item.summary.title}</strong> · {dayLabel.format(dayStart(item.rule!.originalDate))}, {timeLabel.format(new Date(item.startsAt))} МСК</span>
      {editable ? <button className="button light" type="button" disabled={!!opening || pending} onClick={() => void open(item)}>
        {opening === item.key ? 'Открываем…' : 'Изменить или отменить'}
      </button> : null}
    </li>)}</ul>
    <Pager label="Будущие занятия" page={page} total={items.length} size={20} onChange={setPage} />
  </section>;
}
