import { useEffect, useId, useRef, useState } from 'react';
import { useEditorExit } from './editor-exit';
import { usePanelTitle } from './panel';
import { DurationInput, NEW_SESSION_MINUTES } from './duration-input';
import { api, csrf, message } from '../api/client';
import type { components } from '../api/schema';
import { addDays, dateKey, inputTime } from './calendar-time';
import { RussianForm } from './russian-form';
import { publicFields } from './error-feedback';
import { SessionDetails } from './session-card';
import { hasConflict } from './series-conflicts';
import { SeriesPlanTable } from './series-plan-table';
import { moscow } from './workspace';
type Group = components['schemas']['ScheduleGroupView'];
type Series = components['schemas']['SessionSeriesView'];
type Input = components['schemas']['SessionInput'];
type Rule = components['schemas']['SeriesRule'];
type Plan = components['schemas']['SeriesPlan'];
type History = components['schemas']['RecurrenceHistory'];
type Form = {
  title: string;
  startDate: string;
  endDate: string;
  startTime: string;
  duration: string;
  capacity: string;
  ageFrom: string;
  ageTo: string;
  weekdays: number[];
  reason: string;
  cancel: boolean;
};
const week = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const historyNames: Record<string, string> = {
  GROUP_SAVED: 'Сохранена группа',
  SERIES_DRAFT_SAVED: 'Сохранён черновик серии',
  SERIES_DRAFT_DISCARDED: 'Черновик серии отброшен',
  SERIES_PUBLISHED: 'Опубликовано расписание',
};
function model(rule: Rule | null | undefined, date: string, seed?: Input, boundary?: string): Form {
  const local = seed ? inputTime(seed.startsAt) : '';
  const start =
    boundary ??
    (rule
      ? rule.startDate < dateKey(new Date())
        ? dateKey(new Date())
        : rule.startDate
      : local.slice(0, 10) || date);
  return {
    title: seed?.title ?? rule?.title ?? '',
    startDate: start,
    endDate: rule?.endDate ?? addDays(start, 27),
    startTime: local.slice(11, 16) || rule?.startTime.slice(0, 5) || '17:00',
    duration: String(
      seed
        ? (new Date(seed.endsAt).valueOf() - new Date(seed.startsAt).valueOf()) / 60000
        : (rule?.durationMinutes ?? NEW_SESSION_MINUTES),
    ),
    capacity: String(seed?.capacity ?? rule?.capacity ?? 8),
    ageFrom: String(seed?.ageFrom ?? rule?.ageFrom ?? ''),
    ageTo: String(seed?.ageTo ?? rule?.ageTo ?? ''),
    weekdays: rule?.weekdays ?? [((new Date(start + 'T12:00:00+03:00').getUTCDay() + 6) % 7) + 1],
    reason: '',
    cancel: false,
  };
}
export function RecurringGroups({
  date,
  initialInput,
  initialDirty = false,
  initialSeriesId,
  boundary,
  onChanged,
  onClose,
  registerClose,
}: {
  date: string;
  initialInput?: Input;
  initialDirty?: boolean;
  initialSeriesId?: string;
  boundary?: string;
  onChanged: () => Promise<void>;
  onClose: () => void;
  registerClose: (handler: (() => void) | null) => void;
}) {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const errorPrefix = useId();
  const ruleFormId = useId();
  const groupFormId = useId();
  const seed = useRef(initialInput);
  const [importedDirty, setImportedDirty] = useState(initialDirty);
  const [groupMode, setGroupMode] = useState<'list' | 'new' | 'rename'>('list');
  const [step, setStep] = useState<'parameters' | 'check'>('parameters');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [planPage, setPlanPage] = useState(0);
  const [focusError, setFocusError] = useState(0);
  const [cardOpen, setCardOpen] = useState(false);
  const cancellationCount = useRef(0);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [groups, setGroups] = useState<Group[]>([]),
    [series, setSeries] = useState<Series[]>([]),
    [groupId, setGroupId] = useState(initialInput?.groupId ?? '');
  const [current, setCurrent] = useState<Series | null>(null),
    [editing, setEditing] = useState(!!initialInput || !!initialSeriesId);
  const [form, setForm] = useState<Form>(() => model(null, date, initialInput, boundary)),
    [baseline, setBaseline] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null),
    [history, setHistory] = useState<History | null>(null);
  const [historyTarget, setHistoryTarget] = useState<{ id: string; group: boolean } | null>(null);
  const historyGeneration = useRef(0);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [uncertain, setUncertain] = useState(false);
  const [groupName, setGroupName] = useState(''),
    [groupCapacity, setGroupCapacity] = useState('8'),
    [groupAgeFrom, setGroupAgeFrom] = useState(''),
    [groupAgeTo, setGroupAgeTo] = useState(''),
    [renaming, setRenaming] = useState(false);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [uncertainAction, setUncertainAction] = useState<string | null>(null);
  const [groupBaseline, setGroupBaseline] = useState(
    JSON.stringify({ name: '', capacity: '8', ageFrom: '', ageTo: '' }),
  );
  const [remote, setRemote] = useState<Series | null>(null);
  const generation = useRef(0),
    pending = useRef<(() => void) | null>(null),
    keys = useRef({
      save: crypto.randomUUID(),
      publish: crypto.randomUUID(),
      discard: crypto.randomUUID(),
      group: crypto.randomUUID(),
    });
  const fingerprint = JSON.stringify({ form, groupId }),
    groupFingerprint = JSON.stringify({
      name: groupName,
      capacity: groupCapacity,
      ageFrom: groupAgeFrom,
      ageTo: groupAgeTo,
    }),
    dirty =
      groupMode !== 'list'
        ? groupFingerprint !== groupBaseline || importedDirty
        : editing
          ? importedDirty || (baseline !== '' && fingerprint !== baseline)
          : groupFingerprint !== groupBaseline;
  const { navigate, confirmation } = useEditorExit({
    dirty,
    busy,
    uncertain,
    onClose,
    registerClose,
    resources: [
      groupMode !== 'list'
        ? '/lastochka/api/v1/admin/schedule-groups' + (renaming && groupId ? '/' + groupId : '')
        : '/lastochka/api/v1/admin/session-series' + (current?.id ? '/' + current.id : ''),
    ],
  });
  const chosen = groups.find((g) => g.id === groupId);
  usePanelTitle(
    historyOpen
      ? 'История изменений'
      : editing && chosen && groupMode === 'list'
        ? 'Расписание группы · ' + chosen.parameters.name
        : groupMode === 'new'
          ? 'Новая группа'
          : groupMode === 'rename'
            ? 'Изменить группу'
            : 'Группы и расписания',
  );
  function fieldText(name: string) {
    return fields[name] ?? fields['rule.' + name] ?? fields['parameters.' + name] ?? '';
  }
  function fieldProps(name: string) {
    return {
      id: errorPrefix + '-' + name,
      'aria-invalid': !!fieldText(name),
      'aria-describedby': errorPrefix + '-' + name + '-error',
    };
  }
  function fieldError(name: string) {
    return (
      <span id={errorPrefix + '-' + name + '-error'} className="field-error">
        {fieldText(name)}
      </span>
    );
  }
  async function load() {
    const [g, s] = await Promise.all([
      api.GET('/api/v1/admin/schedule-groups'),
      api.GET('/api/v1/admin/session-series'),
    ]);
    if (g.error) throw g.error;
    if (s.error) throw s.error;
    setGroups(g.data.items);
    setSeries(s.data.items);
    return { groups: g.data.items, series: s.data.items };
  }
  useEffect(() => {
    let valid = true;
    void load()
      .then((data) => {
        if (!valid) return;
        const selected = data.series.find((s) => s.id === initialSeriesId);
        const gid = selected?.groupId ?? initialInput?.groupId ?? '';
        setGroupId(gid);
        if (selected) {
          setCurrent(selected);
        }
        const next = model(selected?.draft?.rule ?? selected?.rule, date, initialInput, boundary);
        setForm(next);
        if (!data.groups.length) setGroupMode('new');
        setBaseline(JSON.stringify({ form: next, groupId: gid }));
      })
      .catch((e) => {
        if (valid) setError(message(e));
        setFields(publicFields(e));
      })
      .finally(() => {
        if (valid) setLoading(false);
      });
    return () => {
      valid = false;
      generation.current++;
    };
  }, []);
  function change<K extends keyof Form>(key: K, value: Form[K]) {
    if (uncertain) return;
    setForm((f) => ({ ...f, [key]: value }));
    setPlan(null);
    setCardOpen(false);
    setNotice('');
    setFields({});
    setRemote(null);
    generation.current++;
    keys.current.save = crypto.randomUUID();
    keys.current.publish = crypto.randomUUID();
  }
  function requestFor(state: Series | null = current): components['schemas']['SeriesDraftInput'] {
    return {
      groupId,
      expectedVersion: state?.version ?? 0,
      expectedDraftVersion: state?.draftVersion ?? null,
      rule: {
        title: form.title,
        startDate: form.startDate,
        endDate: form.endDate,
        startTime: form.startTime,
        durationMinutes: Number(form.duration),
        capacity: Number(form.capacity),
        ageFrom: form.ageFrom === '' ? null : Number(form.ageFrom),
        ageTo: form.ageTo === '' ? null : Number(form.ageTo),
        weekdays: form.weekdays,
      },
      reason: form.reason || null,
      cancelFollowing: form.cancel,
    };
  }
  async function check(state: Series | null = current) {
    const n = ++generation.current;
    setBusy(true);
    setError('');
    try {
      const body = requestFor(state),
        headers = await csrf();
      const r = state
        ? await api.POST('/api/v1/admin/session-series/{id}/preview', {
            params: { path: { id: state.id } },
            headers,
            body,
          })
        : await api.POST('/api/v1/admin/session-series/preview', { headers, body });
      if (n !== generation.current) return null;
      if (r.error) throw r.error;
      setPlan(r.data);
      cancellationCount.current = r.data.cancellations;
      setPlanPage(0);
      return r.data;
    } catch (e) {
      if (n === generation.current) setError(message(e));
      setFields(publicFields(e));
      return null;
    } finally {
      if (n === generation.current) setBusy(false);
    }
  }
  async function failure(e: unknown, action: string) {
    setError(message(e));
    setFields(publicFields(e));
    const code = (e as { code?: string })?.code;
    if (code === 'SERIES_START_PASSED' || code === 'SERIES_BEFORE_CURRENT_WEEK') setPlan(null);
    const unknown = code === 'SERVICE_UNAVAILABLE' || (e as { status?: number })?.status === 503;
    setUncertain(unknown);
    setUncertainAction(unknown ? action : null);
    if (code === 'VERSION_CONFLICT' || code === 'SERIES_PLAN_STALE') {
      if (current) {
        const r = await api.GET('/api/v1/admin/session-series/{id}', {
          params: { path: { id: current.id } },
        });
        if (r.data) setRemote(r.data);
      }
    }
  }
  async function save(): Promise<Series | null> {
    setBusy(true);
    setError('');
    try {
      const body = requestFor(),
        headers = { ...(await csrf()), 'Idempotency-Key': keys.current.save };
      if (!alive.current) return null;
      const r = current
        ? await api.PUT('/api/v1/admin/session-series/{id}/draft', {
            params: { path: { id: current.id }, header: { 'Idempotency-Key': keys.current.save } },
            headers,
            body,
          })
        : await api.POST('/api/v1/admin/session-series', {
            params: { header: { 'Idempotency-Key': keys.current.save } },
            headers,
            body,
          });
      if (r.error) throw r.error;
      setCurrent(r.data);
      setUncertain(false);
      setBaseline(fingerprint);
      setImportedDirty(false);
      keys.current.save = crypto.randomUUID();
      await load();
      await onChanged();
      setNotice('Черновик серии сохранён. На сайте изменений пока нет.');
      return r.data;
    } catch (e) {
      await failure(e, 'save');
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!plan?.canPublish) return;
    let target = current;
    let checked = plan;
    if (dirty || !target?.draft) {
      target = await save();
      if (!target) return;
      const next = await check(target);
      if (!next?.canPublish) return;
      checked = next;
    }
    if (!target) return;
    setBusy(true);
    setError('');
    try {
      const headers = await csrf();
      if (!alive.current) return;
      const r = await api.POST('/api/v1/admin/session-series/{id}/publish', {
        params: { path: { id: target.id }, header: { 'Idempotency-Key': keys.current.publish } },
        headers: { ...headers, 'Idempotency-Key': keys.current.publish },
        body: {
          expectedVersion: target.version,
          expectedDraftVersion: target.draftVersion,
          digest: checked.digest,
        },
      });
      if (r.error) throw r.error;
      setCurrent(r.data);
      setPlan(null);
      setUncertain(false);
      setBaseline(fingerprint);
      setImportedDirty(false);
      keys.current.publish = crypto.randomUUID();
      await load();
      await onChanged();
      setStep('parameters');
      cancellationCount.current = 0;
      setNotice('Расписание опубликовано. Все даты применены вместе.');
    } catch (e) {
      await failure(e, 'publish');
    } finally {
      setBusy(false);
    }
  }
  async function discard() {
    if (!current) return;
    setBusy(true);
    setError('');
    try {
      const headers = await csrf();
      if (!alive.current) return;
      const r = await api.DELETE('/api/v1/admin/session-series/{id}/draft', {
        params: { path: { id: current.id }, header: { 'Idempotency-Key': keys.current.discard } },
        headers: { ...headers, 'Idempotency-Key': keys.current.discard },
        body: { expectedVersion: current.version, expectedDraftVersion: current.draftVersion },
      });
      if (r.error) throw r.error;
      setCurrent(r.data);
      const next = model(r.data.rule, date);
      setForm(next);
      setBaseline(JSON.stringify({ form: next, groupId }));
      setPlan(null);
      setNotice('Черновик отброшен. Опубликованные занятия сохранены.');
      setUncertain(false);
      await load();
      await onChanged();
    } catch (e) {
      await failure(e, 'discard');
    } finally {
      setBusy(false);
    }
  }
  async function showHistory(id: string, page = 0, group = false) {
    const n = ++historyGeneration.current;
    const r = group
      ? await api.GET('/api/v1/admin/schedule-groups/{id}/history', {
          params: { path: { id }, query: { page } },
        })
      : await api.GET('/api/v1/admin/session-series/{id}/history', {
          params: { path: { id }, query: { page } },
        });
    if (n !== historyGeneration.current) return;
    if (r.error) {
      setError(message(r.error));
      return;
    }
    setHistory(r.data);
    setHistoryTarget({ id, group });
    setHistoryOpen(true);
  }
  function open(s: Series | null) {
    navigate(() => {
      setCurrent(s);
      setEditing(true);
      const gid = s?.groupId ?? groupId;
      setGroupId(gid);
      const next = model(s?.draft?.rule ?? s?.rule, date, s ? undefined : seed.current);
      if (!s && chosen && !seed.current) {
        next.title = chosen.parameters.name;
        next.capacity = String(chosen.parameters.capacity);
        next.ageFrom = String(chosen.parameters.ageFrom ?? '');
        next.ageTo = String(chosen.parameters.ageTo ?? '');
      }
      setForm(next);
      setBaseline(JSON.stringify({ form: next, groupId: gid }));
      setPlan(null);
      setHistory(null);
      setNotice('');
      setStep('parameters');
      setGroupMode('list');
      setHistoryOpen(false);
      setImportedDirty(!s && initialDirty && !!seed.current);
    });
  }
  async function saveGroup(e?: React.FormEvent<HTMLFormElement>): Promise<boolean> {
    e?.preventDefault();
    setBusy(true);
    setError('');
    const body = {
      expectedVersion: renaming ? (chosen?.version ?? 0) : 0,
      parameters: {
        name: groupName,
        capacity: Number(groupCapacity),
        ageFrom: groupAgeFrom === '' ? null : Number(groupAgeFrom),
        ageTo: groupAgeTo === '' ? null : Number(groupAgeTo),
      },
    };
    try {
      const headers = { ...(await csrf()), 'Idempotency-Key': keys.current.group };
      if (!alive.current) return false;
      const r =
        renaming && chosen
          ? await api.PUT('/api/v1/admin/schedule-groups/{id}', {
              params: {
                path: { id: chosen.id },
                header: { 'Idempotency-Key': keys.current.group },
              },
              headers,
              body,
            })
          : await api.POST('/api/v1/admin/schedule-groups', {
              params: { header: { 'Idempotency-Key': keys.current.group } },
              headers,
              body,
            });
      if (r.error) throw r.error;
      await load();
      setGroupId(r.data.id);
      setRenaming(false);
      setGroupMode('list');
      setGroupName('');
      setGroupBaseline(
        JSON.stringify({
          name: '',
          capacity: groupCapacity,
          ageFrom: groupAgeFrom,
          ageTo: groupAgeTo,
        }),
      );
      setUncertain(false);
      setUncertainAction(null);
      if (editing && !current)
        setForm((f) => ({
          ...f,
          title: f.title || r.data.parameters.name,
          ...(!seed.current
            ? {
                capacity: String(r.data.parameters.capacity),
                ageFrom: String(r.data.parameters.ageFrom ?? ''),
                ageTo: String(r.data.parameters.ageTo ?? ''),
              }
            : {}),
        }));
      keys.current.group = crypto.randomUUID();
      await onChanged();
      setNotice('Группа сохранена. Опубликованные занятия не изменились.');
      return true;
    } catch (e) {
      await failure(e, 'group');
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function checkAndShow() {
    const result = await check();
    if (result) {
      setStep('check');
      setCardOpen(false);
    }
  }
  function startGroup(rename = false) {
    setRenaming(rename);
    setGroupMode(rename ? 'rename' : 'new');
    setHistoryOpen(false);
    const next = {
      name: rename && chosen ? chosen.parameters.name : '',
      capacity: rename && chosen ? String(chosen.parameters.capacity) : '8',
      ageFrom: rename && chosen ? String(chosen.parameters.ageFrom ?? '') : '',
      ageTo: rename && chosen ? String(chosen.parameters.ageTo ?? '') : '',
    };
    setGroupName(next.name);
    setGroupCapacity(next.capacity);
    setGroupAgeFrom(next.ageFrom);
    setGroupAgeTo(next.ageTo);
    setGroupBaseline(JSON.stringify(next));
  }
  function backToGroups() {
    navigate(() => {
      setEditing(false);
      setGroupMode('list');
      setImportedDirty(false);
      seed.current = undefined;
      setHistoryOpen(false);
      setPlan(null);
    });
  }
  function textField(label: string, name: keyof Form, type = 'text', required = true) {
    const key = name === 'duration' ? 'durationMinutes' : name;
    return (
      <label htmlFor={errorPrefix + '-' + key} className={'field-' + name}>
        {label}
        {name === 'duration' ? (
          <DurationInput
            required={required}
            value={form.duration}
            {...fieldProps(key)}
            onValue={(v) => change('duration', v)}
          />
        ) : (
          <input
            type={type}
            required={required}
            min={
              type === 'number' ? (name === 'ageFrom' || name === 'ageTo' ? '0' : '1') : undefined
            }
            max={name === 'ageFrom' || name === 'ageTo' ? 17 : undefined}
            maxLength={name === 'title' ? 120 : undefined}
            value={String(form[name])}
            {...fieldProps(key)}
            onChange={(e) => change(name, e.target.value as never)}
          />
        )}
        {fieldError(key)}
      </label>
    );
  }
  const startForCaption = Date.parse(form.startDate + 'T' + form.startTime + ':00+03:00');
  const endForCaption =
    Number.isFinite(startForCaption) && Number(form.duration) > 0
      ? new Date(startForCaption + Number(form.duration) * 60000)
      : null;
  const parameterView = editing && !!chosen && groupMode === 'list';
  const canChange = !busy && !uncertain;
  return (
    <div className="series-form compact-editor">
      {confirmation}
      <div className="editor-scroll">
        <div className="editor-messages">
          {busy ? <p role="status">Выполняем действие с расписанием…</p> : null}
          {loading ? <p role="status">Загружаем группы и расписания…</p> : null}
          {error ? (
            <p className="notice error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="notice" role="status">
              {notice}
            </p>
          ) : null}
          {uncertain ? (
            <p className="notice">
              Результат пока неизвестен. Можно закрыть окно и уточнить исход над календарём.
            </p>
          ) : null}
          {remote ? (
            <section className="notice">
              <p>Данные на сервере изменились. Ваш ввод сохранён.</p>
              <button
                type="button"
                className="button light"
                onClick={() => {
                  setCurrent(remote);
                  setRemote(null);
                  setPlan(null);
                  keys.current.save = crypto.randomUUID();
                }}
              >
                Использовать актуальную версию для проверки
              </button>
            </section>
          ) : null}
        </div>
        {historyOpen && history && historyTarget ? (
          <section aria-label="История изменений">
            <button type="button" className="button light" onClick={() => setHistoryOpen(false)}>
              Назад
            </button>
            <h3>{historyTarget.group ? 'История группы' : 'История расписания'}</h3>
            {history.items.map((h) => (
              <article className="list-card" key={h.id}>
                <div>
                  <p>
                    {moscow(h.occurredAt)} · {historyNames[h.action] ?? 'Изменено расписание'} ·
                    дат: {h.affected}
                  </p>
                  {h.rule ? (
                    <p>
                      {h.rule.title} · {h.rule.startDate}—{h.rule.endDate} ·{' '}
                      {h.rule.startTime.slice(0, 5)} МСК · {h.rule.durationMinutes} мин
                    </p>
                  ) : null}
                  {h.groupParameters ? (
                    <p>
                      {h.groupParameters.name} · до {h.groupParameters.capacity} человек
                    </p>
                  ) : null}
                </div>
              </article>
            ))}
            <nav aria-label="Страницы истории">
              <button
                type="button"
                className="button light"
                disabled={!history.page}
                onClick={() =>
                  void showHistory(historyTarget.id, history.page - 1, historyTarget.group)
                }
              >
                Предыдущая страница истории
              </button>
              <button
                type="button"
                className="button light"
                disabled={(history.page + 1) * 20 >= history.total}
                onClick={() =>
                  void showHistory(historyTarget.id, history.page + 1, historyTarget.group)
                }
              >
                Следующая страница истории
              </button>
            </nav>
          </section>
        ) : !parameterView ? (
          <>
            {editing && !chosen ? (
              <p>
                Для еженедельного расписания выберите или создайте группу. Параметры занятия
                сохранены в форме.
              </p>
            ) : null}
            {groupMode === 'list' ? (
              <>
                <label>
                  Группа
                  <select
                    value={groupId}
                    disabled={!canChange || loading}
                    onChange={(e) => {
                      setGroupId(e.target.value);
                      setCurrent(null);
                      setPlan(null);
                      if (editing) {
                        const g = groups.find((g) => g.id === e.target.value);
                        if (g) setForm((f) => ({ ...f, title: f.title || g.parameters.name }));
                      }
                    }}
                  >
                    <option value="">Выберите группу</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.parameters.name} · до {g.parameters.capacity} человек
                      </option>
                    ))}
                  </select>
                </label>
                <div className="editor-secondary-actions">
                  <button
                    type="button"
                    className="button light"
                    disabled={!canChange || loading}
                    onClick={() => startGroup()}
                  >
                    Новая группа
                  </button>
                  {chosen ? (
                    <>
                      <button
                        type="button"
                        className="button light"
                        disabled={!canChange}
                        onClick={() => startGroup(true)}
                      >
                        Изменить группу
                      </button>
                      <button
                        type="button"
                        className="button light"
                        disabled={!canChange}
                        onClick={() => void showHistory(chosen.id, 0, true)}
                      >
                        История группы
                      </button>
                    </>
                  ) : null}
                </div>
                {chosen ? (
                  <>
                    <button
                      type="button"
                      className="button"
                      disabled={!canChange}
                      onClick={() => open(null)}
                    >
                      Создать расписание группы
                    </button>
                    {series
                      .filter((s) => s.groupId === chosen.id)
                      .map((s) => (
                        <article className="list-card" key={s.id}>
                          <div>
                            <h3>
                              {s.draft?.rule.title ?? s.rule?.title ?? chosen.parameters.name}
                            </h3>
                            <p>
                              {s.draft
                                ? 'Есть черновик'
                                : s.rule
                                  ? 'Опубликованное расписание'
                                  : 'Нет сохранённого расписания'}{' '}
                              · {(s.draft?.rule ?? s.rule)?.startTime.slice(0, 5)} МСК
                            </p>
                          </div>
                          <button
                            type="button"
                            className="button light"
                            disabled={!canChange}
                            onClick={() => open(s)}
                          >
                            Открыть расписание
                          </button>
                        </article>
                      ))}
                  </>
                ) : null}
              </>
            ) : (
              <>
                {groups.length ? (
                  <button
                    type="button"
                    className="button light"
                    disabled={busy}
                    onClick={() =>
                      navigate(() => {
                        setGroupMode('list');
                        setGroupName('');
                        setGroupCapacity('8');
                        setGroupAgeFrom('');
                        setGroupAgeTo('');
                        setGroupBaseline(
                          JSON.stringify({ name: '', capacity: '8', ageFrom: '', ageTo: '' }),
                        );
                      })
                    }
                  >
                    Назад
                  </button>
                ) : null}
                <RussianForm id={groupFormId} onSubmit={(e) => void saveGroup(e)}>
                  <fieldset className="group-fields" disabled={busy || uncertain || loading}>
                    <label>
                      Название группы
                      <input
                        required
                        maxLength={120}
                        value={groupName}
                        {...fieldProps('name')}
                        onChange={(e) => {
                          setGroupName(e.target.value);
                          keys.current.group = crypto.randomUUID();
                        }}
                      />
                      {fieldError('name')}
                    </label>
                    <label>
                      Размер группы
                      <input
                        required
                        type="number"
                        min="1"
                        value={groupCapacity}
                        {...fieldProps('capacity')}
                        onChange={(e) => setGroupCapacity(e.target.value)}
                      />
                      {fieldError('capacity')}
                    </label>
                    <details className="editor-additional">
                      <summary>Дополнительно · возраст</summary>
                      <div className="additional-fields">
                        <label>
                          Возраст от — необязательно
                          <input
                            type="number"
                            min="0"
                            max="17"
                            value={groupAgeFrom}
                            onChange={(e) => setGroupAgeFrom(e.target.value)}
                          />
                        </label>
                        <label>
                          Возраст до — необязательно
                          <input
                            type="number"
                            min="0"
                            max="17"
                            value={groupAgeTo}
                            onChange={(e) => setGroupAgeTo(e.target.value)}
                          />
                        </label>
                      </div>
                    </details>
                  </fieldset>
                </RussianForm>
              </>
            )}
          </>
        ) : (
          <>
            <nav className="editor-steps" aria-label="Шаг расписания">
              <button type="button" disabled={busy} onClick={backToGroups}>
                ← Группы
              </button>
              <button
                type="button"
                aria-current={step === 'parameters' ? 'step' : undefined}
                onClick={() => setStep('parameters')}
              >
                Параметры
              </button>
              <span>→</span>
              <button
                type="button"
                disabled={!plan}
                aria-current={step === 'check' ? 'step' : undefined}
                onClick={() => setStep('check')}
              >
                Проверка
              </button>
              <span className="muted">
                Еженедельно · МСК
                {endForCaption ? <> · Окончание: {moscow(endForCaption.toISOString())}</> : null}
              </span>
            </nav>
            {step === 'parameters' ? (
              <RussianForm
                id={ruleFormId}
                onSubmit={(e) => {
                  e.preventDefault();
                  const submitter = (e.nativeEvent as SubmitEvent)
                    .submitter as HTMLButtonElement | null;
                  void (submitter?.value === 'save' ? save() : checkAndShow());
                }}
              >
                <fieldset disabled={busy || uncertain || loading}>
                  <div className="series-fields">
                    {textField('Название занятия', 'title')}
                    {textField('Начать с даты', 'startDate', 'date')}
                    {textField('Последняя дата', 'endDate', 'date')}
                    {textField('Время начала', 'startTime', 'time')}
                    {textField('Длительность, минут', 'duration')}
                    {textField('Размер группы', 'capacity', 'number')}
                  </div>
                  <fieldset className="series-weekdays">
                    <legend>Дни повторения</legend>
                    {week.map((name, i) => (
                      <button
                        type="button"
                        className="button light"
                        key={name}
                        aria-pressed={form.weekdays.includes(i + 1)}
                        onClick={() =>
                          change(
                            'weekdays',
                            form.weekdays.includes(i + 1)
                              ? form.weekdays.filter((d) => d !== i + 1)
                              : [...form.weekdays, i + 1].sort(),
                          )
                        }
                      >
                        {name}
                      </button>
                    ))}
                  </fieldset>
                  <details className="editor-additional">
                    <summary>
                      Дополнительно
                      {form.ageFrom || form.ageTo
                        ? ` · Возраст: ${form.ageFrom || '—'}–${form.ageTo || '—'} лет`
                        : ''}
                    </summary>
                    <div className="additional-fields">
                      {textField('Возраст от — необязательно', 'ageFrom', 'number', false)}
                      {textField('Возраст до — необязательно', 'ageTo', 'number', false)}
                    </div>
                    {current?.rule ? (
                      <label>
                        <input
                          type="checkbox"
                          checked={form.cancel}
                          onChange={(e) => change('cancel', e.target.checked)}
                        />{' '}
                        Отменить обычные занятия с выбранной даты
                      </label>
                    ) : null}
                    <div className="editor-secondary-actions">
                      {current ? (
                        <button
                          type="button"
                          className="button light"
                          disabled={busy}
                          onClick={() => void showHistory(current.id)}
                        >
                          История изменений
                        </button>
                      ) : null}
                      {current?.draft ? (
                        <button
                          type="button"
                          className="button light"
                          disabled={!canChange}
                          onClick={() => {
                            if (
                              window.confirm(
                                'Отбросить сохранённый черновик? Опубликованные занятия останутся.',
                              )
                            )
                              void discard();
                          }}
                        >
                          Отбросить черновик серии
                        </button>
                      ) : null}
                    </div>
                  </details>
                </fieldset>
              </RussianForm>
            ) : (
              <section className="series-plan" aria-label="Предпросмотр серии">
                {plan ? (
                  <>
                    <p>
                      Добавится: {plan.creates} · изменится: {plan.changes} · отменится:{' '}
                      {plan.cancellations} · сохранится: {plan.retained}
                    </p>
                    <p>
                      Сохранённых разовых исключений: {plan.items.filter((r) => r.exception).length}
                      . Всего дат: {plan.total}.
                    </p>
                    {plan.items.some(hasConflict) ? (
                      <p className="notice error">
                        Некоторые даты требуют исправления. Причины указаны в таблице.{' '}
                        <button
                          type="button"
                          className="button light"
                          onClick={() => {
                            setCardOpen(false);
                            setPlanPage(Math.floor(plan.items.findIndex(hasConflict) / 10));
                            setFocusError((value) => value + 1);
                          }}
                        >
                          К первому конфликту
                        </button>
                      </p>
                    ) : null}
                    {cardOpen ? (
                      <>
                        <div className="editor-device">
                          <button
                            type="button"
                            className="button light"
                            aria-pressed={device === 'desktop'}
                            onClick={() => setDevice('desktop')}
                          >
                            Компьютер
                          </button>
                          <button
                            type="button"
                            className="button light"
                            aria-pressed={device === 'mobile'}
                            onClick={() => setDevice('mobile')}
                          >
                            Телефон
                          </button>
                        </div>
                        <div className={'series-preview ' + device}>
                          {plan.items.find((r) => r.proposed)?.proposed ? (
                            <SessionDetails
                              session={plan.items.find((r) => r.proposed)!.proposed!}
                              headingLevel={4}
                            />
                          ) : null}
                        </div>
                        <p>Это предпросмотр. Отправка заявки недоступна.</p>
                      </>
                    ) : (
                      <SeriesPlanTable
                        rows={plan.items.slice(planPage * 10, planPage * 10 + 10)}
                        focusError={focusError}
                      />
                    )}
                    <nav className="plan-pagination" aria-label="Страницы плана">
                      <button
                        type="button"
                        className="button light"
                        disabled={!planPage}
                        onClick={() => {
                          setFocusError(0);
                          setPlanPage((p) => p - 1);
                        }}
                      >
                        Предыдущие даты
                      </button>
                      <span>
                        {planPage * 10 + 1}–{Math.min(plan.total, (planPage + 1) * 10)} из{' '}
                        {plan.total}
                      </span>
                      <button
                        type="button"
                        className="button light"
                        disabled={(planPage + 1) * 10 >= plan.total}
                        onClick={() => {
                          setFocusError(0);
                          setPlanPage((p) => p + 1);
                        }}
                      >
                        Следующие даты
                      </button>
                      <button
                        type="button"
                        className="button light"
                        onClick={() => {
                          setFocusError(0);
                          setCardOpen((v) => !v);
                        }}
                      >
                        {cardOpen ? 'Даты плана' : 'Вид карточки'}
                      </button>
                    </nav>
                    {!plan.canPublish ? (
                      <p className="notice error">
                        Публикация недоступна: проверьте указанные даты и причину отмены, если она
                        требуется.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p>Параметры изменены. Повторите проверку.</p>
                )}
                {form.cancel || cancellationCount.current > 0 ? (
                  <label>
                    Причина отмены дат
                    <input
                      maxLength={500}
                      value={form.reason}
                      onChange={(e) => {
                        setForm((f) => ({ ...f, reason: e.target.value }));
                        setPlan(null);
                        keys.current.save = crypto.randomUUID();
                        keys.current.publish = crypto.randomUUID();
                      }}
                    />
                  </label>
                ) : null}
              </section>
            )}
          </>
        )}
      </div>
      {!historyOpen ? (
        <footer className="editor-command-bar">
          {groupMode !== 'list' ? (
            <button
              form={groupFormId}
              type="submit"
              className="button"
              disabled={busy || uncertain || loading}
            >
              Сохранить группу
            </button>
          ) : parameterView ? (
            <>
              {step === 'parameters' ? (
                <>
                  <button
                    form={ruleFormId}
                    type="submit"
                    name="action"
                    value="save"
                    className="button light"
                    disabled={!canChange}
                  >
                    Сохранить черновик
                  </button>
                  <button
                    form={ruleFormId}
                    type="submit"
                    value="check"
                    className="button"
                    disabled={!canChange}
                  >
                    Проверить расписание
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="button light"
                    disabled={busy}
                    onClick={() => setStep('parameters')}
                  >
                    Назад к параметрам
                  </button>
                  {!plan ? (
                    <button
                      type="button"
                      className="button"
                      disabled={!canChange}
                      onClick={() => void checkAndShow()}
                    >
                      Проверить снова
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="button"
                      disabled={!canChange || !plan.canPublish}
                      onClick={() => void publish()}
                    >
                      Опубликовать расписание
                    </button>
                  )}
                </>
              )}
            </>
          ) : (
            <button
              type="button"
              className="button light"
              disabled={busy}
              onClick={() => navigate(onClose)}
            >
              Закрыть
            </button>
          )}
        </footer>
      ) : null}
    </div>
  );
}
