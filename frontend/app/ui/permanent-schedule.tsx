import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { components } from '../api/schema';
import { api, csrf, message } from '../api/client';
import { appPath } from '../api/base-path';
import { dateKey, dayLabel, dayStart, timeLabel } from './calendar-time';
import { editorCommands, editorRevision, subscribeEditorCommands } from './editor-commands';
import { useEditorExit } from './editor-exit';
import { RussianForm } from './russian-form';
import { publicFields } from './error-feedback';
import { DurationInput } from './duration-input';
import './permanent-schedule.css';

type Direction = components['schemas']['AgeDirectionView'];
type Plan = components['schemas']['PermanentPlanView'];
type Slot = { id: number; weekday: string; time: string; duration: string };
const weekdays = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

export function PermanentSchedule({ date, rule, onClose, onChanged, registerClose }: {
  date: string; onClose: () => void; onChanged: () => Promise<void>;
  rule?: components['schemas']['PermanentRuleView'];
  registerClose: (handler: (() => void) | null) => void;
}) {
  const today = dateKey(new Date());
  const earliest = today;
  const [directions, setDirections] = useState<Direction[] | null>(null);
  const [direction, setDirection] = useState('');
  const [startDate, setStartDate] = useState(date < earliest ? earliest : date);
  const [capacity, setCapacity] = useState(String(rule?.capacity ?? 8));
  const [slots, setSlots] = useState<Slot[]>([{ id: 0, weekday: String(rule?.weekday ?? 1), time: rule?.time.slice(0, 5) ?? '17:00', duration: String(rule?.durationMinutes ?? 60) }]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [stopPlan, setStopPlan] = useState<components['schemas']['PermanentStopPreview'] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const prefix = useId();
  const nextId = useRef(1), key = useRef(crypto.randomUUID());
  useSyncExternalStore(subscribeEditorCommands, editorRevision, () => 0);
  const resource = appPath('/api/v1/admin/permanent-schedule');
  const pending = editorCommands().some((entry) => entry.resource === resource);
  const { confirmation } = useEditorExit({ dirty, busy, resources: [resource], onClose, registerClose });
  useEffect(() => {
    let live = true;
    void api.GET('/api/v1/public/age-directions').then((response) => {
      if (!live) return;
      if (response.error) throw response.error;
      setDirections(response.data.items);
      setDirection(rule ? response.data.items.find((item) => item.id === rule.directionId)?.id ?? '' : response.data.items[0]?.id ?? '');
    }).catch((e) => { if (live) setError(message(e)); });
    return () => { live = false; };
  }, []);
  const selected = directions?.find((item) => item.id === direction);
  function changed(action: () => void) {
    action(); setDirty(true); setPlan(null); setStopPlan(null); setError(''); setFields({}); key.current = crypto.randomUUID();
  }
  function fail(value: unknown) {
    const errors = publicFields(value);
    setFields(errors); setError(message(value));
    const field = ['directionId', 'startDate', 'capacity', 'slots', 'boundary'].find((name) => errors[name]);
    if (field) requestAnimationFrame(() => document.getElementById(`${prefix}-${field}`)?.focus());
  }
  function body(): components['schemas']['PermanentPlanInput'] {
    if (!selected) throw new Error('Выберите возрастное направление.');
    return { directionId: selected.id, directionVersion: selected.version, startDate,
      capacity: Number(capacity), slots: slots.map((slot) => ({ weekday: Number(slot.weekday),
        time: slot.time, durationMinutes: Number(slot.duration) })) };
  }
  async function preview(event: React.FormEvent) {
    event.preventDefault();
    if (busy || pending) return;
    setBusy(true); setError('');
    try {
      const response = rule
        ? await api.POST('/api/v1/admin/permanent-schedule/change/preview', { body: { seriesId: rule.seriesId, expectedVersion: rule.version, plan: body() }, headers: await csrf() })
        : await api.POST('/api/v1/admin/permanent-schedule/preview', { body: body(), headers: await csrf() });
      if (response.error) throw response.error;
      setStopPlan(null);
      setPlan(response.data);
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  async function previewStop(event: React.FormEvent) {
    event.preventDefault();
    if (!rule || busy || pending) return;
    setBusy(true); setError('');
    try {
      const response = await api.POST('/api/v1/admin/permanent-schedule/stop/preview', {
        headers: await csrf(), body: { seriesId: rule.seriesId, expectedVersion: rule.version, boundary: startDate },
      });
      if (response.error) throw response.error;
      setPlan(null); setStopPlan(response.data);
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  async function stop() {
    if (!rule || !stopPlan?.canPublish || busy || pending) return;
    setBusy(true); setError('');
    try {
      const response = await api.POST('/api/v1/admin/permanent-schedule/stop', {
        params: { header: { 'Idempotency-Key': key.current } },
        headers: { ...(await csrf()), 'Idempotency-Key': key.current },
        body: { stop: { seriesId: rule.seriesId, expectedVersion: rule.version, boundary: startDate }, digest: stopPlan.digest },
      });
      if (response.error) throw response.error;
      setDirty(false); await onChanged(); onClose();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!plan?.canPublish || !plan.digest || busy || pending) return;
    setBusy(true); setError('');
    try {
      const headers = { ...(await csrf()), 'Idempotency-Key': key.current };
      const response = rule ? await api.POST('/api/v1/admin/permanent-schedule/change', {
        params: { header: { 'Idempotency-Key': key.current } }, headers,
        body: { change: { seriesId: rule.seriesId, expectedVersion: rule.version, plan: body() }, digest: plan.digest },
      }) : await api.POST('/api/v1/admin/permanent-schedule/publish', {
        params: { header: { 'Idempotency-Key': key.current } },
        headers,
        body: { plan: body(), digest: plan.digest },
      });
      if (response.error) throw response.error;
      setDirty(false); await onChanged(); onClose();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  return <>
    <p>{rule ? 'Изменения затронут будущие занятия с выбранной даты. Разовые переносы и отмены сохранятся.' : 'Выберите направление и время каждого занятия. Расписание будет повторяться каждую неделю.'}</p>
    {error ? <p className="notice error" role="alert">{error}</p> : null}
    {!directions ? <p role="status">Загрузка направлений…</p> : null}
    {directions?.length === 0 ? <p className="notice">Нет активных направлений. Обратитесь к администратору.</p> : null}
    <RussianForm className="permanent-form" onSubmit={preview} autoComplete="off">
      <label>Возрастное направление
        <select id={`${prefix}-directionId`} name="directionId" required value={direction} disabled={!directions?.length || busy || pending}
          aria-invalid={!!fields.directionId} aria-describedby={fields.directionId ? `${prefix}-direction-error` : undefined}
          onChange={(event) => changed(() => setDirection(event.target.value))}>
          {!direction ? <option value="">Выберите направление</option> : null}
          {directions?.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>
      {fields.directionId ? <p id={`${prefix}-direction-error`}>{fields.directionId}</p> : null}
      <label>{rule ? 'Изменить с даты' : 'Начать с даты'}
        <input id={`${prefix}-startDate`} name="startDate" required type="date" min={earliest} value={startDate} disabled={busy || pending}
          aria-invalid={!!fields.startDate} aria-describedby={fields.startDate ? `${prefix}-start-error` : undefined}
          onChange={(event) => changed(() => setStartDate(event.target.value))} />
      </label>
      {fields.startDate ? <p id={`${prefix}-start-error`}>{fields.startDate}</p> : null}
      <label>Размер группы
        <input id={`${prefix}-capacity`} name="capacity" required type="number" min="1" step="1" value={capacity} disabled={busy || pending}
          aria-invalid={!!fields.capacity} aria-describedby={fields.capacity ? `${prefix}-capacity-error` : undefined}
          onChange={(event) => changed(() => setCapacity(event.target.value))} />
      </label>
      {fields.capacity ? <p id={`${prefix}-capacity-error`}>{fields.capacity}</p> : null}
      {fields.slots ? <p id={`${prefix}-slots-error`}>{fields.slots}</p> : null}
      <div className="permanent-slots">
        {slots.map((slot, index) => <fieldset key={slot.id} className="permanent-slot" disabled={busy || pending}>
          <legend>Занятие {index + 1}</legend>
          <label>День недели
            <select id={index === 0 ? `${prefix}-slots` : undefined} name={`weekday-${slot.id}`} value={slot.weekday}
              aria-invalid={!!fields.slots} aria-describedby={fields.slots ? `${prefix}-slots-error` : undefined}
              onChange={(event) => changed(() => setSlots((items) => items.map((item) => item.id === slot.id ? { ...item, weekday: event.target.value } : item)))}>
              {weekdays.map((name, i) => <option value={i + 1} key={name}>{name}</option>)}
            </select>
          </label>
          <label>Начало, МСК
            <input name={`time-${slot.id}`} required type="time" value={slot.time} onChange={(event) => changed(() => setSlots((items) => items.map((item) => item.id === slot.id ? { ...item, time: event.target.value } : item)))} />
          </label>
          <div>
            <label htmlFor={`${prefix}-duration-${slot.id}`}>Длительность, минут</label>
            <DurationInput id={`${prefix}-duration-${slot.id}`} name={`duration-${slot.id}`} required max="10079" value={slot.duration}
              onValue={(value) => changed(() => setSlots((items) => items.map((item) => item.id === slot.id ? { ...item, duration: value } : item)))} />
          </div>
          {slots.length > 1 ? <button className="button light" type="button" onClick={() => changed(() => setSlots((items) => items.filter((item) => item.id !== slot.id)))}>Удалить занятие {index + 1}</button> : null}
        </fieldset>)}
      </div>
      <div className="toolbar">
        {!rule ? <button className="button light" type="button" disabled={busy || pending || slots.length >= 30} onClick={() => changed(() => setSlots((items) => [...items, { id: nextId.current++, weekday: '1', time: '17:00', duration: '60' }]))}>Добавить день и время</button> : null}
        <button className="button" type="submit" disabled={busy || pending || !selected}>Проверить расписание</button>
      </div>
    </RussianForm>
    {plan ? <section className="notice" aria-labelledby="permanent-preview-title" aria-live="polite">
      <h2 id="permanent-preview-title">Проверка расписания: {plan.directionTitle}</h2>
      <p>Примеры ближайших дат; занятия повторяются каждую неделю.</p>
      {slots.map((slot, index) => <div key={slot.id}>
        <h3>{weekdays[Number(slot.weekday) - 1]}, {slot.time}</h3>
        <ul>{plan.samples?.[index]?.map((sample) => <li key={sample.date}>
          {dayLabel.format(dayStart(sample.date!))}, {timeLabel.format(new Date(sample.startsAt!))}–{dateKey(sample.startsAt!) !== dateKey(sample.endsAt!) ? `${dayLabel.format(new Date(sample.endsAt!))}, ` : ''}{timeLabel.format(new Date(sample.endsAt!))} МСК
        </li>)}</ul>
        {plan.conflicts?.filter((conflict) => conflict.slot === index).map((conflict, n) =>
          <p role="alert" key={`${conflict.date}-${n}`}>Конфликт: {dayLabel.format(dayStart(conflict.date!))}. Проверьте занятое время.</p>)}
      </div>)}
      {plan.hasPendingDrafts ? <p role="alert">Перед публикацией проверьте или завершите несохранённые черновики расписания.</p> : null}
      {rule && plan.affected.length ? <>
        <h3>Изменятся существующие занятия</h3>
        <ul>{plan.affected.map((item) => <li key={item.session.id}>
          {dayLabel.format(dayStart(item.originalDate))}: {item.action === 'CANCEL' ? 'занятие будет отменено' : item.action === 'KEEP_PAST' ? 'уже начавшееся занятие сохранится' : 'будут обновлены условия и время'}
        </li>)}</ul>
      </> : null}
      <button className="button" type="button" onClick={() => void publish()} disabled={!plan.canPublish || busy || pending}>{rule ? 'Применить изменения' : 'Опубликовать расписание'}</button>
    </section> : null}
    {rule ? <details className="danger-actions">
      <summary>Остановить еженедельное расписание</summary>
      <p>Будущие занятия с выбранной даты будут отменены. Разовые переносы и прежние заявки сохранятся.</p>
      <RussianForm onSubmit={previewStop} autoComplete="off">
        <label>Остановить с даты
          <input id={`${prefix}-boundary`} name="boundary" required type="date" min={today} value={startDate} disabled={busy || pending}
            aria-invalid={!!fields.boundary} aria-describedby={fields.boundary ? `${prefix}-boundary-error` : undefined}
            onChange={(event) => changed(() => setStartDate(event.target.value))} />
        </label>
        {fields.boundary ? <p id={`${prefix}-boundary-error`}>{fields.boundary}</p> : null}
        <button className="button light" type="submit" disabled={busy || pending}>Проверить остановку</button>
      </RussianForm>
      {stopPlan ? <section className="notice" aria-label="Проверка остановки" aria-live="polite">
        {stopPlan.affected.length ? <ul>{stopPlan.affected.map((item) => <li key={item.session.id}>
          {dayLabel.format(dayStart(item.originalDate))}: {item.action === 'KEEP_PAST' ? 'уже начавшееся занятие сохранится' : 'занятие будет отменено'}
        </li>)}</ul> : <p>Созданных занятий для отмены нет.</p>}
        {stopPlan.hasPendingDrafts ? <p role="alert">Перед остановкой проверьте или завершите черновики расписания.</p> : null}
        <button className="button" type="button" disabled={!stopPlan.canPublish || busy || pending} onClick={() => void stop()}>Подтвердить остановку расписания</button>
      </section> : null}
    </details> : null}
    {confirmation}
  </>;
}
