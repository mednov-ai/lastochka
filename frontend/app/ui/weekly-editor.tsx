import { useCallback, useEffect, useRef, useState } from 'react';
import { api, csrf, message } from '../api/client';
import { Panel } from './panel';
import { RussianForm } from './russian-form';
import { weekdays, weeklyTime, type WeeklyInterval, type WeeklySchedule } from './weekly-interval';
import './weekly-editor.css';

type Draft = { slot?: WeeklyInterval; weekday: number };
const endpoint = '/api/v1/admin/schedule/weekly';
const item = '/api/v1/admin/schedule/weekly/{id}';

export function WeeklyEditor({
  editable,
  manageAges,
  categoriesOpen,
}: {
  editable: boolean;
  manageAges?: () => void;
  categoriesOpen: boolean;
}) {
  const [week, setWeek] = useState<WeeklySchedule | null>(null);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [stale, setStale] = useState(false);
  const command = useRef({ body: '', key: '' });
  const generation = useRef(0);
  const saving = useRef(false);
  const load = useCallback(async () => {
    const n = ++generation.current;
    setLoadError('');
    const r = await api.GET(endpoint);
    if (generation.current !== n) return;
    if (r.error) setLoadError(message(r.error));
    else setWeek(r.data);
  }, []);
  useEffect(() => {
    if (!categoriesOpen) void load();
    const refresh = () => {
      if (!categoriesOpen && !saving.current) void load();
    };
    window.addEventListener('lastochka:calendar-settled', refresh);
    return () => {
      generation.current++;
      window.removeEventListener('lastochka:calendar-settled', refresh);
    };
  }, [load, categoriesOpen]);
  function open(next: Draft) {
    setError('');
    setNotice('');
    setConfirm(false);
    setStale(false);
    setDraft(next);
    command.current = { body: '', key: '' };
  }
  async function save(form: HTMLFormElement | null) {
    if (!editable || !draft || saving.current || stale) return;
    const slot = draft.slot;
    const path = { id: slot?.reference.seriesId ?? '' };
    const revision = slot?.reference.revision ?? 0;
    const data = form ? new FormData(form) : null;
    const [hour, minute] = String(data?.get('time') ?? '0:0')
      .split(':')
      .map(Number);
    const body = {
      expectedRevision: revision,
      directionId: String(data?.get('direction') ?? ''),
      weekday: Number(data?.get('weekday')),
      startMinute: hour * 60 + minute,
      durationMinutes: Number(data?.get('duration')),
    };
    const signature = JSON.stringify([path, form ? body : revision]);
    if (command.current.body !== signature)
      command.current = { body: signature, key: crypto.randomUUID() };
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const header = { 'Idempotency-Key': command.current.key };
      const headers = { ...(await csrf()), ...header };
      const response = !form
        ? await api.DELETE(item, {
            params: { path, header, query: { expectedRevision: revision } },
            headers,
          })
        : slot
          ? await api.PUT(item, { params: { path, header }, headers, body })
          : await api.POST(endpoint, { params: { header }, headers, body });
      if (response.error) {
        if (response.error.code === 'VERSION_CONFLICT') {
          setStale(true);
          await load();
          setError('Расписание уже изменили. Закройте форму и откройте актуальный интервал.');
        } else setError(message(response.error));
        return;
      }
      setDraft(null);
      setNotice(form ? 'Интервал опубликован.' : 'Интервал снят с публикации.');
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const slot = draft?.slot;
  const spaces = week?.directions.filter((d) => d.active) ?? [];
  return (
    <section className="weekly-admin" aria-label="Постоянное расписание">
      <header className="weekly-admin-head">
        <div>
          <h2>Типовая неделя</h2>
          <p>Время московское. Занятия повторяются каждую неделю.</p>
        </div>
        <div className="weekly-admin-actions">
          {manageAges && (
            <button className="button light" onClick={manageAges}>
              Возрастные категории
            </button>
          )}
          {editable && (
            <button
              className="button"
              disabled={!spaces.length || !!loadError}
              onClick={() => open({ weekday: 1 })}
            >
              Добавить интервал
            </button>
          )}
        </div>
      </header>
      {loadError && (
        <p role="alert" className="notice error">
          {loadError}{' '}
          <button className="button light" onClick={load}>
            Повторить загрузку
          </button>
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {!week && !loadError && <p role="status">Загрузка расписания…</p>}
      {week && (
        <div className="weekly-agenda">
          {weekdays.map((day, i) => {
            const slots = week.intervals
              .filter((s) => s.weekday === i + 1)
              .sort((a, b) => a.startMinute - b.startMinute);
            return (
              <section key={day} className="weekly-day">
                <h3>{day}</h3>
                {slots.length ? (
                  <ul>
                    {slots.map((s) => {
                      const category = week.directions.find((d) => d.id === s.directionId);
                      return (
                        <li key={s.reference.seriesId}>
                          <strong>{weeklyTime(s)}</strong>
                          <span>
                            {category?.title}
                            {category && !category.active ? ' · в архиве' : ''}
                          </span>
                          {editable && (
                            <button
                              className="weekly-edit"
                              aria-label={`Изменить: ${day}, ${weeklyTime(s)}, ${category?.title}`}
                              onClick={() => open({ slot: s, weekday: s.weekday })}
                            >
                              Изменить
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p>Нет занятий</p>
                )}
              </section>
            );
          })}
        </div>
      )}
      {draft && (
        <Panel
          title={slot ? 'Изменить интервал' : 'Новый интервал'}
          onClose={() => {
            if (!saving.current) setDraft(null);
          }}
        >
          <RussianForm
            className="weekly-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save(e.currentTarget);
            }}
          >
            <p>Изменения появятся в расписании на каждую неделю.</p>
            <fieldset disabled={busy || !editable || stale}>
              <label>
                Возрастная категория
                <select name="direction" required defaultValue={slot?.directionId ?? ''}>
                  <option value="" disabled>
                    Выберите категорию
                  </option>
                  {spaces.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                День недели
                <select name="weekday" defaultValue={draft.weekday}>
                  {weekdays.map((d, i) => (
                    <option key={d} value={i + 1}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <div className="weekly-clock">
                <label>
                  Начало, МСК
                  <input
                    name="time"
                    type="time"
                    required
                    defaultValue={slot ? weeklyTime(slot).split('–')[0] : '17:00'}
                  />
                </label>
                <label>
                  Длительность, мин
                  <input
                    type="number"
                    name="duration"
                    min="1"
                    max="10079"
                    required
                    defaultValue={slot?.durationMinutes ?? 45}
                  />
                </label>
              </div>
              <button className="button" type="submit">
                {busy ? 'Сохранение…' : 'Опубликовать'}
              </button>
              {slot && !confirm && (
                <button className="weekly-edit" type="button" onClick={() => setConfirm(true)}>
                  Снять с публикации
                </button>
              )}
              {confirm && (
                <div className="notice">
                  <p>Снять интервал со всех недель? Полученные заявки сохранятся.</p>
                  <button type="button" className="button light" onClick={() => setConfirm(false)}>
                    Оставить
                  </button>{' '}
                  <button type="button" className="button" onClick={() => void save(null)}>
                    Снять интервал
                  </button>
                </div>
              )}
            </fieldset>
            {!editable && <p role="status">Доступ к редактированию отозван.</p>}
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
          </RussianForm>
        </Panel>
      )}
    </section>
  );
}
