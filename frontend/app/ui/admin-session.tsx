import { useState, useEffect, useRef, useId } from 'react';
import { useEditorExit } from './editor-exit';
import { DurationInput, NEW_SESSION_MINUTES } from './duration-input';
import { RussianForm } from './russian-form';
import { publicFields } from './error-feedback';
import { api, csrf, message } from '../api/client';
import type { components } from '../api/schema';
import { moscow, Status } from './workspace';
import { addDays, dateKey, inputTime } from './calendar-time';
import { SessionDetails } from './session-card';
import { NewSeriesPlan } from './new-series-plan';
import { usePanelTitle } from './panel';
type Session = components['schemas']['SessionView'];
type Input = components['schemas']['SessionInput'];
type Editor = components['schemas']['SessionEditorView'];
type Draft = components['schemas']['SessionDraftView'];
type History = components['schemas']['SessionHistory'];
type Series = components['schemas']['SessionSeriesView'];
type Plan = components['schemas']['SeriesPlan'];
type Rule = components['schemas']['SeriesRule'];
const weekdays = [
  ['Пн', 'Понедельник'],
  ['Вт', 'Вторник'],
  ['Ср', 'Среда'],
  ['Чт', 'Четверг'],
  ['Пт', 'Пятница'],
  ['Сб', 'Суббота'],
  ['Вс', 'Воскресенье'],
] as const;
type Model = {
  title: string;
  format: 'GROUP' | 'INDIVIDUAL';
  date: string;
  time: string;
  duration: string;
  capacity: string;
  ageFrom: string;
  ageTo: string;
};
function model(s: Input | Session | null, date: string, proposed?: string): Model {
  const start = proposed ?? s?.startsAt;
  const local = start ? inputTime(start) : '';
  return {
    title: s?.title ?? '',
    format: s?.format === 'INDIVIDUAL' ? 'INDIVIDUAL' : 'GROUP',
    date: local.slice(0, 10) || date,
    time: local.slice(11) || '17:00',
    duration: s
      ? String((new Date(s.endsAt).valueOf() - new Date(s.startsAt).valueOf()) / 60000)
      : String(NEW_SESSION_MINUTES),
    capacity: String(s?.capacity ?? 8),
    ageFrom: s?.ageFrom != null ? String(s.ageFrom) : '',
    ageTo: s?.ageTo != null ? String(s.ageTo) : '',
  };
}
function input(m: Model): Input {
  const start = new Date(`${m.date}T${m.time}:00+03:00`);
  return {
    title: m.title,
    format: m.format,
    startsAt: start.toISOString(),
    endsAt: new Date(start.valueOf() + Number(m.duration) * 60000).toISOString(),
    capacity: m.format === 'INDIVIDUAL' ? 1 : Number(m.capacity),
    ageFrom: m.ageFrom === '' ? null : Number(m.ageFrom),
    ageTo: m.ageTo === '' ? null : Number(m.ageTo),
    replaceAgeRange: true,
  };
}
const actionNames: Record<string, string> = {
  SESSION_CREATED: 'Создан черновик',
  SESSION_UPDATED: 'Изменены параметры',
  SESSION_PUBLISH: 'Опубликовано',
  SESSION_CLOSE: 'Приём закрыт',
  SESSION_REOPEN: 'Приём открыт',
  SESSION_CANCEL: 'Занятие отменено',
  SESSION_DRAFT_SAVED: 'Сохранён черновик',
  SESSION_DRAFT_PUBLISHED: 'Опубликованы изменения',
  SESSION_DRAFT_RESTORED: 'Подготовлено восстановление',
  SESSION_DRAFT_DISCARDED: 'Черновик удалён',
};
export function AdminSession({
  session,
  proposed,
  proposedDuration,
  groups,
  membership,
  onRepeat,
  selectedDate,
  onSaved,
  onCalendarChanged,
  onSeriesEdit,
  onClose,
  registerClose,
}: {
  session: Session | null;
  proposed?: string;
  proposedDuration?: number;
  groups: components['schemas']['ScheduleGroupView'][];
  membership?: components['schemas']['SessionMembership'];
  onRepeat: (input: Input, unsaved: boolean) => void;
  selectedDate: string;
  onSaved: (session: Session, displayDate?: string) => Promise<void>;
  onCalendarChanged: () => Promise<void>;
  onSeriesEdit: (id: string) => void;
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
  const [base, setBase] = useState(session);
  const [groupId, setGroupId] = useState(membership?.groupId ?? '');
  const [baselineGroup, setBaselineGroup] = useState(membership?.groupId ?? '');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [form, setForm] = useState(() => ({
    ...model(session, selectedDate, proposed),
    ...(proposedDuration != null ? { duration: String(proposedDuration) } : {}),
  }));
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(
      session
        ? model(session, selectedDate)
        : {
            ...model(null, selectedDate, proposed),
            ...(proposedDuration != null ? { duration: String(proposedDuration) } : {}),
          },
    ),
  );
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!session);
  const [, setReview] = useState(false);
  const [preview, setPreview] = useState(false);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [repeat, setRepeat] = useState(false);
  const [endDate, setEndDate] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const [series, setSeries] = useState<Series | null>(null);
  const [seriesPlan, setSeriesPlan] = useState<Plan | null>(null);
  const [baselineRepeat, setBaselineRepeat] = useState('');
  const [seriesUncertain, setSeriesUncertain] = useState(false);
  const repeatFields = useRef<HTMLDivElement>(null);
  const seriesKeys = useRef({ save: crypto.randomUUID(), publish: crypto.randomUUID() });

  const formId = useId();
  const [historyView, setHistoryView] = useState(false);
  const [history, setHistory] = useState<History | null>(null);
  const [remote, setRemote] = useState<Editor | null>(null);
  const [pendingAction, setPendingAction] = useState<'CLOSE' | 'REOPEN' | null>(null);
  const groupSize = useRef(session?.format === 'GROUP' ? String(session.capacity) : '8');
  const key = useRef(crypto.randomUUID());
  const repeatFingerprint = JSON.stringify({ endDate, days });
  const dirty =
    JSON.stringify(form) !== baseline ||
    groupId !== baselineGroup ||
    (repeat && repeatFingerprint !== baselineRepeat);
  const { confirmation } = useEditorExit({
    dirty,
    busy,
    uncertain: seriesUncertain,
    onClose,
    registerClose,
    resources: [
      '/lastochka/api/v1/admin/sessions' + (base?.id ? '/' + base.id : ''),
      '/lastochka/api/v1/admin/session-series' + (series?.id ? '/' + series.id : ''),
    ],
  });
  const active = !base || base.status !== 'CANCELLED';
  const futureSession = !!base && new Date(base.startsAt).valueOf() > Date.now();
  usePanelTitle(!base ? 'Новое занятие' : active ? 'Изменить занятие' : 'Просмотр занятия');
  useEffect(() => {
    if (!session) return;
    let valid = true;
    void api
      .GET('/api/v1/admin/sessions/{id}/draft', { params: { path: { id: session.id } } })
      .then((r) => {
        if (!valid) return;
        if (r.error) setError(message(r.error));
        else {
          setBase(r.data.session);
          setDraft(r.data.draft ?? null);
          const next = {
            ...model(r.data.draft?.session ?? r.data.session, selectedDate, proposed),
            ...(proposedDuration != null ? { duration: String(proposedDuration) } : {}),
          };
          setForm(next);
          setBaseline(JSON.stringify(model(r.data.draft?.session ?? r.data.session, selectedDate)));
        }
        setLoading(false);
      });
    return () => {
      valid = false;
    };
  }, [session?.id]);
  function currentInput(): Input {
    return { ...input(form), ...(groupId ? { groupId } : {}) };
  }
  function change<K extends keyof Model>(k: K, v: Model[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    setNotice('');
    key.current = crypto.randomUUID();
    invalidateSeriesPlan();
  }
  function invalidateSeriesPlan() {
    setSeriesPlan(null);
    seriesKeys.current.save = crypto.randomUUID();
    seriesKeys.current.publish = crypto.randomUUID();
  }
  function repeatRule(): Rule {
    return {
      title: form.title,
      startDate: form.date,
      endDate,
      weekdays: days,
      startTime: form.time,
      durationMinutes: Number(form.duration),
      capacity: Number(form.capacity),
      ageFrom: form.ageFrom === '' ? null : Number(form.ageFrom),
      ageTo: form.ageTo === '' ? null : Number(form.ageTo),
    };
  }
  function seriesInput(target: Series | null) {
    return {
      groupId: target?.groupId ?? groupId,
      expectedVersion: target?.version ?? 0,
      expectedDraftVersion: target?.draftVersion ?? null,
      rule: repeatRule(),
      cancelFollowing: false,
    };
  }
  function validateDays() {
    if (days.length) return true;
    setError('Выберите хотя бы один день повторения.');
    return false;
  }
  async function checkSeries(target: Series | null = series): Promise<Plan | null> {
    if (!validateDays()) return null;
    setBusy(true);
    setError('');
    setFields({});
    try {
      const headers = await csrf();
      if (!alive.current) return null;
      const r = target
        ? await api.POST('/api/v1/admin/session-series/{id}/preview', {
            params: { path: { id: target.id } },
            headers,
            body: seriesInput(target),
          })
        : groupId
          ? await api.POST('/api/v1/admin/session-series/preview', {
              headers,
              body: seriesInput(null),
            })
          : await api.POST('/api/v1/admin/session-series/new-group/preview', {
              headers,
              body: { rule: repeatRule() },
            });
      if (!alive.current) return null;
      if (r.error) throw r.error;
      setSeriesPlan(r.data);
      return r.data;
    } catch (e) {
      if (alive.current) {
        setError(message(e));
        setFields(publicFields(e));
      }
      return null;
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function saveSeries(): Promise<Series | null> {
    if (!validateDays()) return null;
    setBusy(true);
    setError('');
    setFields({});
    try {
      const headers = await csrf();
      if (!alive.current) return null;
      const command = seriesKeys.current.save;
      const r = series
        ? await api.PUT('/api/v1/admin/session-series/{id}/draft', {
            params: { path: { id: series.id }, header: { 'Idempotency-Key': command } },
            headers,
            body: seriesInput(series),
          })
        : groupId
          ? await api.POST('/api/v1/admin/session-series', {
              params: { header: { 'Idempotency-Key': command } },
              headers,
              body: seriesInput(null),
            })
          : await api.POST('/api/v1/admin/session-series/new-group', {
              params: { header: { 'Idempotency-Key': command } },
              headers,
              body: { rule: repeatRule() },
            });
      if (r.error) throw r.error;
      if (!alive.current) return null;
      setSeries(r.data);
      setGroupId(r.data.groupId);
      setBaselineGroup(r.data.groupId);
      setBaseline(JSON.stringify(form));
      setBaselineRepeat(repeatFingerprint);
      setSeriesPlan(null);
      seriesKeys.current.save = crypto.randomUUID();
      await onCalendarChanged();
      if (!alive.current) return null;
      setNotice('Черновик серии сохранён. На сайте изменений пока нет.');
      return r.data;
    } catch (e) {
      if (alive.current) {
        setError(message(e));
        setFields(publicFields(e));
        if ((e as { code?: string })?.code === 'SERVICE_UNAVAILABLE') setSeriesUncertain(true);
      }
      return null;
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function publishSeries() {
    if (!seriesPlan?.canPublish) return;
    let target = series;
    let checked = seriesPlan;
    if (!target?.draft || dirty) {
      target = await saveSeries();
      if (!target || !alive.current) return;
      const fresh = await checkSeries(target);
      if (!fresh?.canPublish || !alive.current) {
        setPreview(true);
        return;
      }
      checked = fresh;
    }
    if (!target || !alive.current) return;
    setBusy(true);
    setError('');
    try {
      const headers = await csrf();
      if (!alive.current) return;
      const r = await api.POST('/api/v1/admin/session-series/{id}/publish', {
        params: {
          path: { id: target.id },
          header: { 'Idempotency-Key': seriesKeys.current.publish },
        },
        headers,
        body: {
          expectedVersion: target.version,
          expectedDraftVersion: target.draftVersion,
          digest: checked.digest,
        },
      });
      if (r.error) throw r.error;
      if (!alive.current) return;
      setSeries(r.data);
      setSeriesPlan(null);
      setPreview(false);
      seriesKeys.current.publish = crypto.randomUUID();
      await onCalendarChanged();
      if (alive.current) setNotice('Расписание опубликовано. Все даты применены вместе.');
    } catch (e) {
      if (alive.current) {
        setError(message(e));
        setFields(publicFields(e));
        if (
          ['SERIES_START_PASSED', 'SERIES_BEFORE_CURRENT_WEEK'].includes(
            (e as { code?: string })?.code ?? '',
          )
        )
          setSeriesPlan(null);
        if ((e as { code?: string })?.code === 'SERVICE_UNAVAILABLE') setSeriesUncertain(true);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function accept(state: Editor, text: string, displayDate?: string) {
    setBase(state.session);
    setBaselineGroup(groupId);
    setDraft(state.draft ?? null);
    const next = model(state.draft?.session ?? state.session, selectedDate);
    setForm(next);
    setBaseline(JSON.stringify(next));
    setRemote(null);
    setReview(false);
    key.current = crypto.randomUUID();
    await onSaved(
      state.session,
      displayDate ?? state.draft?.session.startsAt ?? state.session.startsAt,
    );
    setNotice(text);
  }
  async function fail(e: unknown) {
    setError(message(e));
    setFields(publicFields(e));
    if (!(e && typeof e === 'object' && 'code' in e && e.code === 'SERVICE_UNAVAILABLE'))
      key.current = crypto.randomUUID();
    if (base) {
      const r = await api.GET('/api/v1/admin/sessions/{id}/draft', {
        params: { path: { id: base.id } },
      });
      if (r.data) setRemote(r.data);
    }
  }
  async function saveDraft(): Promise<boolean> {
    setBusy(true);
    setError('');
    setFields({});
    setNotice('');
    try {
      const body = currentInput();
      const headers = await csrf();
      if (!alive.current) return false;
      if (!base || base.status === 'DRAFT') {
        const r = base
          ? await api.PUT('/api/v1/admin/sessions/{id}', {
              params: { path: { id: base.id }, header: { 'Idempotency-Key': key.current } },
              headers,
              body: { expectedVersion: base.version, session: body },
            })
          : await api.POST('/api/v1/admin/sessions', {
              params: { header: { 'Idempotency-Key': key.current } },
              headers,
              body,
            });
        if (r.error) throw r.error;
        await accept(
          { session: r.data, draft: null },
          'Черновик сохранён. Пока не видно на сайте.',
        );
      } else {
        const r = await api.PUT('/api/v1/admin/sessions/{id}/draft', {
          params: { path: { id: base.id }, header: { 'Idempotency-Key': key.current } },
          headers,
          body: {
            expectedSessionVersion: base.version,
            expectedDraftVersion: draft?.version ?? null,
            session: body,
          },
        });
        if (r.error) throw r.error;
        await accept(r.data, 'Черновик сохранён. На сайте прежние условия.');
      }
      return true;
    } catch (e) {
      await fail(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function discardDraft() {
    if (
      !base ||
      !draft ||
      dirty ||
      !window.confirm('Отбросить сохранённый черновик? Опубликованные условия останутся.')
    )
      return;
    setBusy(true);
    try {
      const headers = await csrf();
      if (!alive.current) return;
      const r = await api.DELETE('/api/v1/admin/sessions/{id}/draft', {
        params: { path: { id: base.id }, header: { 'Idempotency-Key': crypto.randomUUID() } },
        headers,
        body: { expectedSessionVersion: base.version, expectedDraftVersion: draft.version },
      });
      if (r.error) throw r.error;
      await accept(r.data, 'Черновик отброшен. Опубликованные условия сохранены.');
    } catch (e) {
      await fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!base) return;
    setBusy(true);
    setError('');
    try {
      const headers = await csrf();
      if (!alive.current) return;
      if (base.status === 'DRAFT') {
        const r = await api.POST('/api/v1/admin/sessions/{id}/actions', {
          params: { path: { id: base.id }, header: { 'Idempotency-Key': key.current } },
          headers,
          body: { expectedVersion: base.version, action: 'PUBLISH' },
        });
        if (r.error) throw r.error;
        await accept({ session: r.data, draft: null }, 'Занятие опубликовано.');
      } else {
        const r = await api.POST('/api/v1/admin/sessions/{id}/draft/publish', {
          params: { path: { id: base.id }, header: { 'Idempotency-Key': key.current } },
          headers,
          body: {
            expectedSessionVersion: base.version,
            expectedDraftVersion: draft?.version ?? null,
          },
        });
        if (r.error) throw r.error;
        await accept(r.data, 'Изменения опубликованы.');
      }
    } catch (e) {
      await fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function status(action: 'CLOSE' | 'REOPEN' | 'CANCEL', reason?: string) {
    if (!base) return;
    setBusy(true);
    setError('');
    try {
      const headers = await csrf();
      if (!alive.current) return;
      const r = await api.POST('/api/v1/admin/sessions/{id}/actions', {
        params: { path: { id: base.id }, header: { 'Idempotency-Key': crypto.randomUUID() } },
        headers,
        body: { expectedVersion: base.version, action, reason },
      });
      if (r.error) throw r.error;
      setBase(r.data);

      setPendingAction(null);
      setNotice('Изменение приёма сохранено.');
      await onSaved(r.data);
    } catch (e) {
      await fail(e);
    } finally {
      setBusy(false);
    }
  }
  async function loadHistory(page = 0) {
    if (!base) return;
    const r = await api.GET('/api/v1/admin/sessions/{id}/history', {
      params: { path: { id: base.id }, query: { page } },
    });
    if (r.error) setError(message(r.error));
    else {
      setHistory(r.data);
      setHistoryView(true);
    }
  }
  async function restore(revisionId: number) {
    if (!base) return;
    if (dirty) {
      setError('Сначала сохраните введённые изменения или верните сохранённые значения.');
      return;
    }
    setBusy(true);
    try {
      const headers = await csrf();
      if (!alive.current) return;
      const r = await api.POST('/api/v1/admin/sessions/{id}/history/{revisionId}/restore-draft', {
        params: {
          path: { id: base.id, revisionId },
          header: { 'Idempotency-Key': crypto.randomUUID() },
        },
        headers,
        body: {
          expectedSessionVersion: base.version,
          expectedDraftVersion: draft?.version ?? null,
        },
      });
      if (r.error) throw r.error;
      await accept(r.data, 'Прежние параметры подготовлены в черновике. Проверьте и опубликуйте.');
    } catch (e) {
      await fail(e);
    } finally {
      setBusy(false);
    }
  }
  let future: Input | null = null;
  try {
    future = currentInput();
  } catch {
    /* incomplete native date */
  }
  function field(
    label: string,
    name: keyof Model,
    type = 'text',
    options: { required?: boolean; max?: number; maxLength?: number } = {},
  ) {
    const errorKey = name === 'date' || name === 'time' ? 'startsAt' : name;
    const props = {
      name: name === 'time' ? 'startsAt' : name,
      id: formId + '-' + name,
      required: options.required ?? true,
      max: options.max,
      maxLength: options.maxLength,
      'aria-invalid': !!fields[errorKey],
      'aria-describedby': formId + '-' + name + '-error',
    };
    return (
      <label htmlFor={props.id} className={'session-field field-' + name}>
        {label}
        {name === 'duration' ? (
          <DurationInput {...props} value={form.duration} onValue={(v) => change('duration', v)} />
        ) : (
          <input
            {...props}
            type={type}
            min={type === 'number' ? (name === 'capacity' ? '1' : '0') : undefined}
            value={form[name]}
            onChange={(e) => change(name, e.target.value)}
          />
        )}
        <span className="field-error" id={formId + '-' + name + '-error'}>
          {fields[errorKey]}
        </span>
      </label>
    );
  }
  return (
    <div className="session-editor compact-editor">
      {confirmation}
      <div className="editor-scroll">
        {loading ? <p role="status">Загрузка редактора…</p> : null}
        <div className="editor-messages">
          {busy ? <p role="status">Выполняем действие с занятием…</p> : null}
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
          {seriesUncertain ? (
            <p className="notice">
              Результат сохранения пока неизвестен. Закройте окно и уточните исход над календарём.
            </p>
          ) : null}
          {base ? (
            <p className="editor-state">
              <Status value={base.status} />{' '}
              {draft
                ? 'Есть неопубликованные изменения'
                : base.status === 'DRAFT'
                  ? 'Черновик'
                  : 'Опубликовано'}
              {dirty ? ' · Есть несохранённые правки' : ''}
              {future ? <span>Окончание: {moscow(future.endsAt)}</span> : null}
            </p>
          ) : (
            <p className="muted">
              Новое занятие · МСК
              {future ? <span> · Окончание: {moscow(future.endsAt)}</span> : null}
            </p>
          )}
        </div>
        {remote ? (
          <section className="notice">
            <h3>Актуальные сохранённые условия</h3>
            <SessionDetails session={remote.session} />
            <p>Ваш ввод остался в форме. Примите актуальную основу и снова сохраните черновик.</p>
            <button
              type="button"
              className="button light"
              disabled={busy}
              onClick={() => {
                setBase(remote.session);
                setDraft(remote.draft ?? null);
                setBaseline(
                  JSON.stringify(model(remote.draft?.session ?? remote.session, selectedDate)),
                );
                setRemote(null);
                setError('');
                setPreview(false);
                key.current = crypto.randomUUID();
              }}
            >
              Принять актуальную основу и оставить мой ввод
            </button>
          </section>
        ) : null}
        {historyView ? (
          <section className="editor-history">
            <button type="button" className="button light" onClick={() => setHistoryView(false)}>
              Назад к параметрам
            </button>
            <h3>Сохранённые версии</h3>
            {history?.items.map((h) => (
              <article className="list-card" key={h.id}>
                <div>
                  <p>
                    {actionNames[h.action] ?? 'Изменение занятия'} · {moscow(h.occurredAt)}
                  </p>
                  {h.after ? <SessionDetails session={h.after} headingLevel={4} /> : null}
                </div>
                {active ? (
                  <button
                    type="button"
                    className="button light"
                    disabled={busy || dirty || !h.after}
                    onClick={() => void restore(h.id)}
                  >
                    Восстановить в черновик
                  </button>
                ) : null}
              </article>
            ))}
            {history ? (
              <div className="toolbar">
                <button
                  type="button"
                  className="button light"
                  disabled={history.page === 0}
                  onClick={() => void loadHistory(history.page - 1)}
                >
                  Назад
                </button>
                <span>Страница {history.page + 1}</span>
                <button
                  type="button"
                  className="button light"
                  disabled={(history.page + 1) * 20 >= history.total}
                  onClick={() => void loadHistory(history.page + 1)}
                >
                  Далее
                </button>
              </div>
            ) : null}
          </section>
        ) : (
          <>
            <nav className="editor-steps" aria-label="Шаг редактора">
              <button
                type="button"
                aria-current={!preview ? 'step' : undefined}
                onClick={() => {
                  setPreview(false);
                  setReview(false);
                }}
              >
                Параметры
              </button>
              <span>→</span>
              <button
                type="button"
                disabled={!active || busy || (repeat && !seriesPlan)}
                aria-current={preview ? 'step' : undefined}
                onClick={() => {
                  setPreview(true);
                  setReview(true);
                }}
              >
                Проверка
              </button>
            </nav>
            {!preview ? (
              <>
                {active ? (
                  <RussianForm
                    id={formId}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const submitter = (e.nativeEvent as SubmitEvent)
                        .submitter as HTMLButtonElement | null;
                      if (!base && repeat) {
                        if (submitter?.value === 'check-series')
                          void checkSeries().then((plan) => {
                            if (plan && alive.current) setPreview(true);
                          });
                        else void saveSeries();
                      } else void saveDraft();
                    }}
                  >
                    <fieldset
                      disabled={busy || loading || seriesUncertain || !!series?.rule}
                      className="session-fields"
                    >
                      {field('Название', 'title', 'text', { maxLength: 120 })}
                      <label className="field-format">
                        Формат
                        <select
                          aria-label="Формат"
                          name="format"
                          value={form.format}
                          disabled={!!series}
                          onChange={(e) => {
                            const format = e.target.value as Model['format'];
                            if (format === 'INDIVIDUAL') {
                              groupSize.current = form.capacity;
                              setForm((f) => ({ ...f, format, capacity: '1' }));
                              setRepeat(false);
                            } else setForm((f) => ({ ...f, format, capacity: groupSize.current }));
                            invalidateSeriesPlan();
                          }}
                        >
                          <option value="GROUP">Мини-группа</option>
                          <option value="INDIVIDUAL">Индивидуально</option>
                        </select>
                      </label>
                      {field('Дата занятия · МСК', 'date', 'date')}
                      {field('Начало · МСК', 'time', 'time')}
                      {field('Длительность, минут', 'duration')}
                      {form.format === 'GROUP' ? (
                        <>
                          {field('Размер группы', 'capacity', 'number')}
                          <label className="field-group">
                            Группа
                            <select
                              value={groupId}
                              disabled={!!membership?.seriesId || busy || !!series}
                              onChange={(e) => {
                                setGroupId(e.target.value);
                                key.current = crypto.randomUUID();
                                invalidateSeriesPlan();
                              }}
                            >
                              <option value="">
                                {!base && repeat ? 'Новая группа' : 'Самостоятельное занятие'}
                              </option>
                              {groups.map((g) => (
                                <option key={g.id} value={g.id}>
                                  {g.parameters.name} · до {g.parameters.capacity} человек
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="repeat-row">
                            {series ? (
                              <span>Еженедельное повторение</span>
                            ) : (
                              <button
                                type="button"
                                className="button light"
                                disabled={busy || !future || (!!base && !futureSession)}
                                aria-expanded={!base ? repeat : undefined}
                                onClick={() => {
                                  if (base) onRepeat(currentInput(), dirty);
                                  else {
                                    if (!repeat && !endDate) {
                                      setEndDate(addDays(form.date, 27));
                                      setDays([
                                        ((new Date(form.date + 'T12:00:00+03:00').getUTCDay() + 6) %
                                          7) +
                                          1,
                                      ]);
                                    }
                                    setRepeat((value) => !value);
                                    invalidateSeriesPlan();
                                    if (!repeat)
                                      requestAnimationFrame(() =>
                                        repeatFields.current?.scrollIntoView({ block: 'nearest' }),
                                      );
                                  }
                                }}
                              >
                                {membership?.seriesId
                                  ? 'Это и последующие занятия серии'
                                  : repeat
                                    ? 'Не повторять'
                                    : 'Еженедельно · выбрать дни'}
                              </button>
                            )}
                            {membership ? (
                              <span>
                                {membership.groupName} · Только это занятие
                                {membership.exception ? ' · Разовое изменение' : ''}
                              </span>
                            ) : null}
                            {!base && repeat ? (
                              <span>
                                {groupId
                                  ? 'Расписание будет связано с выбранной группой.'
                                  : 'При сохранении создадим группу с названием и параметрами занятия.'}
                              </span>
                            ) : null}
                          </div>
                          {!base && repeat ? (
                            <div className="inline-repeat" ref={repeatFields}>
                              <fieldset className="series-weekdays">
                                <legend>Дни повторения</legend>
                                <div className="weekday-buttons">
                                  {weekdays.map(([short, full], index) => (
                                    <button
                                      type="button"
                                      className="button light"
                                      key={short}
                                      aria-label={full}
                                      aria-pressed={days.includes(index + 1)}
                                      onClick={() => {
                                        setDays((previous) =>
                                          previous.includes(index + 1)
                                            ? previous.filter((day) => day !== index + 1)
                                            : [...previous, index + 1].sort((a, b) => a - b),
                                        );
                                        invalidateSeriesPlan();
                                        setError('');
                                      }}
                                    >
                                      {short}
                                    </button>
                                  ))}
                                </div>
                              </fieldset>
                              <label>
                                Последняя дата повторения · МСК
                                <input
                                  type="date"
                                  required
                                  min={form.date}
                                  value={endDate}
                                  onChange={(e) => {
                                    setEndDate(e.target.value);
                                    invalidateSeriesPlan();
                                  }}
                                />
                              </label>
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <p>Индивидуально · 1 человек</p>
                      )}
                      <details className="editor-additional">
                        <summary>
                          Дополнительно
                          {form.ageFrom || form.ageTo
                            ? ` · Возраст: ${form.ageFrom || '—'}–${form.ageTo || '—'} лет`
                            : ''}
                        </summary>
                        <div className="additional-fields">
                          {field('Возраст от — необязательно', 'ageFrom', 'number', {
                            required: form.ageTo !== '',
                            max: 17,
                          })}
                          {field('Возраст до — необязательно', 'ageTo', 'number', {
                            required: form.ageFrom !== '',
                            max: 17,
                          })}
                        </div>
                      </details>
                    </fieldset>
                  </RussianForm>
                ) : (
                  <section>
                    <p>Отменённое занятие доступно только для просмотра.</p>
                    {base ? <SessionDetails session={base} /> : null}
                  </section>
                )}
                {base ? (
                  <div className="editor-secondary-actions">
                    {draft && active ? (
                      <button
                        type="button"
                        className="button light"
                        disabled={busy || dirty}
                        onClick={() => void discardDraft()}
                      >
                        Отбросить черновик
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="button light"
                      disabled={busy}
                      onClick={() => void loadHistory()}
                    >
                      История изменений
                    </button>
                    {active && futureSession && base.status !== 'DRAFT' ? (
                      <button
                        type="button"
                        className="button light"
                        disabled={busy}
                        onClick={() => {
                          const action = base.status === 'OPEN' ? 'CLOSE' : 'REOPEN';
                          if (dirty) setPendingAction(action);
                          else void status(action);
                        }}
                      >
                        {base.status === 'OPEN' ? 'Закрыть приём' : 'Открыть приём'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {pendingAction ? (
                  <section className="notice">
                    <p>Есть несохранённые правки. Изменение приёма не публикует их.</p>
                    <button
                      type="button"
                      className="button light"
                      disabled={busy}
                      onClick={() => void status(pendingAction)}
                    >
                      Изменить приём без применения ввода
                    </button>
                    <button
                      type="button"
                      className="button light"
                      onClick={() => setPendingAction(null)}
                    >
                      Вернуться
                    </button>
                  </section>
                ) : null}
                {base && active && futureSession ? (
                  <details className="danger-actions">
                    <summary>Отмена занятия</summary>
                    <RussianForm
                      onSubmit={(e) => {
                        e.preventDefault();
                        void status('CANCEL', String(new FormData(e.currentTarget).get('reason')));
                      }}
                    >
                      <label>
                        Причина отмены
                        <input name="reason" required maxLength={500} />
                      </label>
                      <button className="button light" disabled={busy}>
                        Подтвердить отмену занятия
                      </button>
                    </RussianForm>
                  </details>
                ) : null}
              </>
            ) : repeat && !base ? (
              seriesPlan ? (
                <NewSeriesPlan plan={seriesPlan} rule={repeatRule()} />
              ) : (
                <p>Параметры изменены. Повторите проверку расписания.</p>
              )
            ) : (
              <section className="editor-preview" aria-label="Предпросмотр занятия">
                <h3>Проверьте изменение занятия</h3>
                {base && future && base.startsAt !== future.startsAt ? (
                  <p className="notice">
                    При изменении времени может измениться доступность занятия для новых заявок.
                    После публикации она определяется временем начала и состоянием приёма. Прежние
                    заявки сохранятся.
                  </p>
                ) : null}
                {base && base.status !== 'DRAFT' ? (
                  <details open>
                    <summary>Сейчас на сайте</summary>
                    <SessionDetails session={base} />
                  </details>
                ) : null}
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
                <div className={'public-preview ' + device}>
                  {future ? (
                    <SessionDetails session={future} />
                  ) : (
                    <p>Заполните параметры занятия.</p>
                  )}
                </div>
                <p className="muted">Это предпросмотр. Отправка заявки недоступна.</p>
                {!base || dirty ? <p>Сохраните черновик перед публикацией.</p> : null}
              </section>
            )}
          </>
        )}
      </div>
      {!historyView && active ? (
        <footer className="editor-command-bar">
          {repeat && !base && series?.rule ? (
            <button type="button" className="button" onClick={() => onSeriesEdit(series.id)}>
              Изменить расписание
            </button>
          ) : repeat && !base ? (
            preview ? (
              <>
                <button
                  type="button"
                  className="button light"
                  disabled={busy}
                  onClick={() => setPreview(false)}
                >
                  Назад к параметрам
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy || seriesUncertain || !seriesPlan?.canPublish}
                  onClick={() => void publishSeries()}
                >
                  Опубликовать расписание
                </button>
              </>
            ) : (
              <>
                <button
                  form={formId}
                  type="submit"
                  value="save-series"
                  className="button light"
                  disabled={busy || loading || seriesUncertain}
                >
                  Сохранить черновик
                </button>
                <button
                  form={formId}
                  type="submit"
                  value="check-series"
                  className="button"
                  disabled={busy || loading || seriesUncertain}
                >
                  Проверить расписание
                </button>
              </>
            )
          ) : (
            <>
              <button
                type="button"
                className="button light"
                disabled={busy || loading}
                onClick={() => {
                  if (preview) {
                    setPreview(false);
                    setReview(false);
                    requestAnimationFrame(
                      () =>
                        document.getElementById(formId) instanceof HTMLFormElement &&
                        (document.getElementById(formId) as HTMLFormElement).requestSubmit(),
                    );
                  } else (document.getElementById(formId) as HTMLFormElement)?.requestSubmit();
                }}
              >
                Сохранить черновик
              </button>
              {preview ? (
                <button
                  type="button"
                  className="button"
                  disabled={busy || dirty || !base || (base.status !== 'DRAFT' && !draft)}
                  onClick={() => void publish()}
                >
                  Подтвердить публикацию
                </button>
              ) : (
                <button
                  type="button"
                  className="button"
                  disabled={busy || loading}
                  onClick={() => {
                    setPreview(true);
                    setReview(true);
                  }}
                >
                  Проверить изменения
                </button>
              )}
            </>
          )}
        </footer>
      ) : null}
    </div>
  );
}
