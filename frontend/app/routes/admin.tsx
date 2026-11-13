import { EditorCommandStatus } from '../ui/editor-command-status';
import { EnquiryNotifications } from '../ui/enquiry-notifications';
import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { useParams, Link } from 'react-router';
import { UserFacingError, publicFields } from '../ui/error-feedback';
import { api, csrf, message } from '../api/client';
import type { components } from '../api/schema';
import { Workspace, moscow } from '../ui/workspace';
import { useAuth } from '../ui/auth-context';
import { StudioCalendar } from '../ui/studio-calendar';
import { SessionDetails } from '../ui/session-card';
import { RecurringGroups } from '../ui/recurring-groups';
import { AgeDirections } from '../ui/age-directions';
import { PermanentSchedule } from '../ui/permanent-schedule';
import { PermanentRules } from '../ui/permanent-rules';
import { loadScheduleProjection } from '../ui/schedule-projection';
import type { ScheduleEntry } from '../ui/schedule-occurrence';
import { editorCommands, editorRevision, subscribeEditorCommands } from '../ui/editor-commands';
import { appPath } from '../api/base-path';
import { AdminSession } from '../ui/admin-session';
import { Panel } from '../ui/panel';
import { Pager } from '../ui/pager';
import { RussianForm } from '../ui/russian-form';
import { PhoneInput } from '../ui/phone-input';
import { phoneFromForm } from '../ui/phone';
import { uiText } from '../ui/ui-texts';
import { addDays, dateKey, dayStart, monday, dayLabel } from '../ui/calendar-time';
import { can } from '../ui/access';
import { ScheduleGroupsReadOnly, ScheduleSessionReadOnly } from '../ui/schedule-read-only';
import { PaymentTables } from '../ui/payment-tables';
import '../ui/admin-schedule.css';
type Session = components['schemas']['SessionView'];
type Enquiry = components['schemas']['EnquiryView'];
type Payment = components['schemas']['PaymentView'];
type Delivery = components['schemas']['DeliveryView'];
export default function Admin() {
  const { section } = useParams();
  const { auth } = useAuth();
  const canScheduleEdit = can(auth?.account, 'SCHEDULE_EDIT');
  const canPaymentEdit = can(auth?.account, 'PAYMENT_EDIT');
  const allowed =
    auth?.state === 'FULL' &&
    (section === 'schedule'
      ? can(auth.account, 'SCHEDULE_VIEW')
      : section === 'requests'
        ? can(auth.account, 'ENQUIRIES_VIEW')
        : section === 'payments'
          ? can(auth.account, 'PAYMENT_VIEW')
          : false);
  const [date, setDate] = useState(() => dateKey(new Date()));
  const [mode, setMode] = useState<'day' | 'week' | 'list'>('week');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [calculated, setCalculated] = useState<ScheduleEntry[]>([]);
  const [openingCalculated, setOpeningCalculated] = useState('');
  const [calculatedError, setCalculatedError] = useState('');
  const openingCalculatedRef = useRef(false);
  useSyncExternalStore(subscribeEditorCommands, editorRevision, () => 0);
  const [groups, setGroups] = useState<components['schemas']['ScheduleGroupView'][]>([]);
  const [calendarContext, setCalendarContext] = useState<
    components['schemas']['SeriesCalendarContext']
  >({ memberships: [], drafts: [], warnings: [] });
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [archivedPayments, setArchivedPayments] = useState<Payment[]>([]);
  const [activePaymentPage, setActivePaymentPage] = useState(0);
  const [archivedPaymentPage, setArchivedPaymentPage] = useState(0);
  const [activePaymentTotal, setActivePaymentTotal] = useState(0);
  const [archivedPaymentTotal, setArchivedPaymentTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<
    | { kind: 'session'; value: Session | null; proposed?: string; proposedDuration?: number }
    | { kind: 'ages' }
    | { kind: 'permanent'; rule?: components['schemas']['PermanentRuleView'] }
    | { kind: 'permanent-rules' }
    | { kind: 'calculated'; value: ScheduleEntry }
    | {
        kind: 'groups';
        initialDirty?: boolean;
        initialInput?: components['schemas']['SessionInput'];
        initialSeriesId?: string;
        boundary?: string;
      }
    | { kind: 'enquiry'; value: Enquiry }
    | { kind: 'payment'; value: Payment | null; source?: Enquiry; readOnly?: boolean }
    | null
  >(null);
  const [confirmLostAccess, setConfirmLostAccess] = useState(false);
  const opened = useRef<{ kind: string | null; editable: boolean }>({
    kind: null,
    editable: false,
  });
  if (opened.current.kind !== (panel?.kind ?? null)) {
    opened.current = {
      kind: panel?.kind ?? null,
      editable:
        panel?.kind === 'payment'
          ? canPaymentEdit && !panel.readOnly
          : panel?.kind === 'ages'
            ? auth?.account?.role === 'ADMIN'
            : panel?.kind === 'session' || panel?.kind === 'groups' || panel?.kind === 'permanent'
              ? canScheduleEdit
              : false,
    };
  }
  const accessLost =
    !!panel &&
    opened.current.editable &&
    (panel.kind === 'payment'
      ? !canPaymentEdit
      : panel.kind === 'ages'
        ? auth?.account?.role !== 'ADMIN'
        : panel.kind === 'session' || panel.kind === 'groups' || panel.kind === 'permanent'
          ? !canScheduleEdit
          : false);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const sectionRef = useRef(section);
  sectionRef.current = section;
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [pushDelivery, setPushDelivery] = useState<components['schemas']['PushSummary'] | null>(
    null,
  );
  const generation = useRef(0);
  const closeSession = useRef<(() => void) | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const deliveryGeneration = useRef(0);
  useEffect(() => {
    if (auth?.state === 'FULL' && !allowed && panel && !accessLost) {
      deliveryGeneration.current++;
      setPanel(null);
    }
  }, [auth?.state, allowed, panel, accessLost]);
  const from = mode === 'day' ? date : monday(date);
  const load = useCallback(async () => {
    if (!allowed) return;
    const n = ++generation.current;
    setLoading(true);
    setError('');
    setCalculatedError('');
    setSessions([]);
    setCalculated([]);
    try {
      if (section === 'schedule') {
        const query = {
          from: dayStart(from).toISOString(),
          to: dayStart(addDays(from, mode === 'day' ? 1 : 7)).toISOString(),
        };
        const [r, context, groupList, projection] = await Promise.all([
          api.GET('/api/v1/admin/calendar', { params: { query } }),
          api.GET('/api/v1/admin/session-series/calendar', { params: { query } }),
          api.GET('/api/v1/admin/schedule-groups'),
          loadScheduleProjection(dayStart(addDays(from, -7)).toISOString(), query.to, true),
        ]);
        if (n !== generation.current) return;
        if (r.error) throw r.error;
        if (context.error) throw context.error;
        if (groupList.error) throw groupList.error;
        const existing = new Map(r.data.items.map((item) => [item.id, item]));
        const memberships = new Set(context.data.memberships.filter((item) => item.seriesId && item.originalDate)
          .map((item) => `${item.seriesId}:${item.originalDate}`));
        const relevant = projection.filter((item) => new Date(item.summary.endsAt).valueOf() > new Date(query.from).valueOf());
        for (const item of relevant) {
          if (!item.sessionId) continue;
          const session = existing.get(item.sessionId);
          if (!session || session.version !== item.sessionVersion)
            throw new Error('Расписание изменилось во время загрузки. Повторите загрузку.');
        }
        setCalendarContext(context.data);
        setGroups(groupList.data.items);
        setSessions(r.data.items);
        setCalculated(relevant.filter((item) => !item.sessionId && item.rule &&
          !memberships.has(`${item.rule.seriesId}:${item.rule.originalDate}`)));
      } else if (section === 'requests') {
        const r = await api.GET('/api/v1/admin/enquiries', { params: { query: { page } } });
        if (n !== generation.current) return;
        if (r.error) throw r.error;
        setEnquiries(r.data.items);
        setTotal(r.data.total);
      } else if (section === 'payments') {
        const [r, archived] = await Promise.all([
          api.GET('/api/v1/admin/payment-requests', {
            params: { query: { page: activePaymentPage, category: 'ACTIVE' } },
          }),
          api.GET('/api/v1/admin/payment-requests', {
            params: { query: { page: archivedPaymentPage, category: 'ARCHIVED' } },
          }),
        ]);
        if (n !== generation.current) return;
        if (r.error) throw r.error;
        if (archived.error) throw archived.error;
        setPayments(r.data.items);
        setArchivedPayments(archived.data.items);
        setActivePaymentTotal(r.data.total);
        setArchivedPaymentTotal(archived.data.total);
        setActivePaymentPage((current) =>
          Math.min(current, Math.max(0, Math.ceil(r.data.total / 20) - 1)),
        );
        setArchivedPaymentPage((current) =>
          Math.min(current, Math.max(0, Math.ceil(archived.data.total / 20) - 1)),
        );
      }
    } catch (e) {
      if (n === generation.current) setError(message(e));
    } finally {
      if (n === generation.current) setLoading(false);
    }
  }, [allowed, section, from, mode, page, activePaymentPage, archivedPaymentPage]);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  useEffect(() => {
    deliveryGeneration.current++;
    setPanel(null);
    setPage(0);
    setNotice('');
  }, [section]);
  async function saved(text: string) {
    setPanel(null);
    setNotice(text);
    await load();
  }
  async function openCalculated(entry: ScheduleEntry) {
    if (!entry.rule) return;
    if (!canScheduleEdit || new Date(entry.startsAt).valueOf() <= Date.now()) {
      setPanel({ kind: 'calculated', value: entry }); return;
    }
    const resource = appPath('/api/v1/admin/permanent-schedule');
    if (openingCalculatedRef.current || editorCommands().some((command) => command.resource === resource)) return;
    openingCalculatedRef.current = true;
    setOpeningCalculated(entry.key);
    setCalculatedError('');
    const key = crypto.randomUUID();
    try {
      const response = await api.POST('/api/v1/admin/permanent-schedule/occurrence', {
        params: { header: { 'Idempotency-Key': key } },
        headers: { ...(await csrf()), 'Idempotency-Key': key },
        body: entry.rule,
      });
      if (response.error) throw response.error;
      await loadRef.current();
      if (sectionRef.current === 'schedule' && panelRef.current === null)
        setPanel({ kind: 'session', value: response.data });
    } catch (err) { setCalculatedError(message(err)); }
    finally { openingCalculatedRef.current = false; setOpeningCalculated(''); }
  }
  async function openEnquiry(value: Enquiry) {
    const request = ++deliveryGeneration.current;
    setPanel({ kind: 'enquiry', value });
    setDelivery(null);
    setPushDelivery(null);
    try {
      const [r, pushResult] = await Promise.all([
        api.GET('/api/v1/admin/enquiries/{id}/delivery', {
          params: { path: { id: value.id } },
        }),
        api.GET('/api/v1/admin/enquiries/{id}/browser-push', {
          params: { path: { id: value.id } },
        }),
      ]);
      if (request !== deliveryGeneration.current) return;
      if (r.error) throw r.error;
      setDelivery(r.data);
      if (pushResult.error) throw pushResult.error;
      setPushDelivery(pushResult.data ?? null);
    } catch (e) {
      if (request === deliveryGeneration.current) setError(message(e));
    }
  }
  async function retry(id: string) {
    const request = deliveryGeneration.current;
    try {
      const r = await api.POST('/api/v1/admin/enquiries/{id}/delivery/retry', {
        params: { path: { id } },
        headers: await csrf(),
      });
      if (request !== deliveryGeneration.current) return;
      if (r.error) throw r.error;
      setDelivery(r.data);
    } catch (e) {
      if (request === deliveryGeneration.current) setError(message(e));
    }
  }
  if (auth?.state === 'FULL' && !allowed && !accessLost)
    return (
      <Workspace title="Раздел недоступен">
        <p>У вас нет доступа к этому разделу. Обратитесь к администратору.</p>
      </Workspace>
    );
  return (
    <Workspace
      title={
        section === 'schedule'
          ? 'Расписание'
          : section === 'requests'
            ? 'Заявки'
            : section === 'payments'
              ? 'Подготовка оплаты'
              : 'Раздел недоступен'
      }
    >
      {allowed ? (
        <EditorCommandStatus onChanged={load} />
      ) : (
        <p className="notice">Доступ к разделу отозван.</p>
      )}
      {error ? (
        <div className="notice error" role="alert">{error}{section === 'schedule' ? <button type="button" className="button light" onClick={() => void load()}>Повторить загрузку</button> : null}</div>
      ) : null}
      {calculatedError ? <p className="notice error" role="alert">{calculatedError}</p> : null}
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
      {loading ? <p role="status">Загрузка…</p> : null}
      {allowed && section === 'schedule' ? (
        <>
          <div className="schedule-toolbar">
            <p className="schedule-period">
              {dayLabel.format(dayStart(from))}
              {mode !== 'day' ? ' — ' + dayLabel.format(dayStart(addDays(from, 6))) : ''}
            </p>
            <div className="schedule-actions">
              {canScheduleEdit ? (
                <button className="button" type="button" onClick={() => setPanel({ kind: 'permanent' })}>
                  Создать расписание
                </button>
              ) : null}
              <button className="button light" type="button" onClick={() => setPanel({ kind: 'permanent-rules' })}>
                Постоянное расписание
              </button>
              {canScheduleEdit ? (
                <button
                  className="button"
                  onClick={(e) => {
                    e.currentTarget.focus({ preventScroll: true });
                    setPanel({ kind: 'session', value: null });
                  }}
                >
                  Создать занятие
                </button>
              ) : null}
              {auth.account?.role === 'ADMIN' ? (
                <button
                  type="button"
                  className="button light"
                  onClick={() => setPanel({ kind: 'ages' })}
                >
                  Возрастные направления
                </button>
              ) : null}
              <button
                type="button"
                className="button light"
                onClick={(e) => {
                  e.currentTarget.focus({ preventScroll: true });
                  setPanel({ kind: 'groups' });
                }}
              >
                Группы
              </button>
            </div>
            <div className="schedule-navigation">
              <div className="schedule-navigation-buttons">
                <button
                  type="button"
                  className="button light"
                  data-calendar-focus
                  onClick={() => setDate(dateKey(new Date()))}
                >
                  Сегодня
                </button>
                <span className="schedule-arrows">
                  <button
                    type="button"
                    className="button light"
                    onClick={() => setDate(addDays(date, mode === 'day' ? -1 : -7))}
                    aria-label="Предыдущий период"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    className="button light"
                    onClick={() => setDate(addDays(date, mode === 'day' ? 1 : 7))}
                    aria-label="Следующий период"
                  >
                    →
                  </button>
                </span>
              </div>
              <label>
                Дата
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            </div>
            <label>
              Вид
              <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="day">День</option>
                <option value="week">Неделя</option>
                <option value="list">Список</option>
              </select>
            </label>
          </div>
          {calendarContext.warnings.map((warning, index) => (
            <p className="notice error" role="alert" key={index}>
              {warning} Откройте «Группы», чтобы проверить черновик серии.
            </p>
          ))}
          {!loading && !error && dayStart(from).valueOf() < Date.now() ? (
            <p className="schedule-past-note">Прошедшие расчётные даты показаны как неподтверждённый план, а не как проведённые занятия.</p>
          ) : null}
          {!loading && !error ? (
            <StudioCalendar
              readOnly={!canScheduleEdit}
              date={from}
              selectedDate={date}
              sessions={sessions}
              calculated={calculated}
              onCalculatedSelect={(entry) => void openCalculated(entry)}
              openingCalculated={openingCalculated}
              mode={mode}
              onSelect={(value) => setPanel({ kind: 'session', value })}
              onMove={(value, proposed) => setPanel({ kind: 'session', value, proposed })}
              onResize={(value, ends) =>
                setPanel({
                  kind: 'session',
                  value,
                  proposedDuration:
                    (new Date(ends).valueOf() - new Date(value.startsAt).valueOf()) / 60000,
                })
              }
              onCreate={(proposed, proposedDuration) =>
                setPanel({ kind: 'session', value: null, proposed, proposedDuration })
              }
              memberships={calendarContext.memberships}
              drafts={calendarContext.drafts}
              onSeriesSelect={(initialSeriesId) => setPanel({ kind: 'groups', initialSeriesId })}
              selectedId={selectedId}
              onDaySelect={(value) => {
                setDate(value);
              }}
            />
          ) : null}
        </>
      ) : null}
      {allowed && section === 'requests' ? (
        <>
          <p>Обращения не резервируют места. Свяжитесь с родителем для согласования.</p>
          {allowed && auth?.account?.id ? (
            <EnquiryNotifications
              accountId={auth.account.id}
              canManage={auth.account.role === 'ADMIN'}
            />
          ) : null}
          <div className="stack">
            {enquiries.map((e) => (
              <article className="list-card" key={e.id}>
                <div>
                  <h2>Заявка №{e.number}</h2>
                  <p>
                    {e.parentName} · {e.phone}
                  </p>
                  <p>{moscow(e.createdAt)}</p>
                </div>
                <button className="button" onClick={() => void openEnquiry(e)}>
                  Открыть заявку
                </button>
              </article>
            ))}
          </div>
          {!loading && !enquiries.length ? <p>Заявок пока нет.</p> : null}
          <Pager label="Заявки" page={page} total={total} size={25} onChange={setPage} />
        </>
      ) : null}
      {allowed && section === 'payments' ? (
        <>
          <p className="notice">Все банковские операции и ссылки в этом разделе — тестовые.</p>
          {canPaymentEdit ? (
            <button
              className="button"
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                setPanel({ kind: 'payment', value: null });
              }}
            >
              Создать черновик оплаты
            </button>
          ) : null}
          <PaymentTables
            active={payments}
            archived={archivedPayments}
            activePage={activePaymentPage}
            archivedPage={archivedPaymentPage}
            activeTotal={activePaymentTotal}
            archivedTotal={archivedPaymentTotal}
            onActivePage={setActivePaymentPage}
            onArchivedPage={setArchivedPaymentPage}
            canEdit={canPaymentEdit}
            onOpen={(value, readOnly) => setPanel({ kind: 'payment', value, readOnly })}
            onChanged={load}
          />
        </>
      ) : null}
      {panel ? (
        <Panel
          compact={panel.kind === 'session' || panel.kind === 'groups' || panel.kind === 'permanent'}
          payment={panel.kind === 'payment'}
          key={panel.kind}
          title={
            panel.kind === 'permanent-rules'
              ? 'Постоянное расписание'
              : panel.kind === 'calculated'
              ? 'Просмотр занятия'
              : panel.kind === 'permanent'
              ? panel.rule ? 'Изменить расписание' : 'Новое расписание'
              : panel.kind === 'groups'
              ? 'Группы и повторения'
              : panel.kind === 'ages'
                ? 'Возрастные направления'
                : panel.kind === 'session'
                  ? panel.value
                    ? panel.value.status === 'CANCELLED' || !canScheduleEdit
                      ? 'Просмотр занятия'
                      : 'Изменить занятие'
                    : 'Новое занятие'
                  : panel.kind === 'enquiry'
                    ? `Заявка №${panel.value.number}`
                    : 'Черновик оплаты'
          }
          onClose={() => {
            if (accessLost) {
              setConfirmLostAccess(true);
              return;
            }
            if (
              (panel.kind === 'session' || panel.kind === 'groups' || panel.kind === 'ages' || panel.kind === 'permanent') &&
              closeSession.current
            ) {
              closeSession.current();
              return;
            }
            deliveryGeneration.current++;
            setPanel(null);
          }}
        >
          {accessLost ? (
            <div className="notice" role="status">
              Доступ на изменение отозван. Ввод сохранён в открытой форме, но отправить его нельзя.
              {confirmLostAccess ? (
                <>
                  <p>Закрыть форму и отбросить несохранённый ввод?</p>
                  <button className="button light" onClick={() => setConfirmLostAccess(false)}>
                    Остаться
                  </button>
                  <button
                    className="button light"
                    onClick={() => {
                      setConfirmLostAccess(false);
                      setPanel(null);
                    }}
                  >
                    Выйти без сохранения
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          {panel.kind === 'permanent-rules' ? (
            <PermanentRules editable={canScheduleEdit} onEdit={(rule) => setPanel({ kind: 'permanent', rule })} />
          ) : panel.kind === 'calculated' ? (
            <><p>{new Date(panel.value.startsAt).valueOf() <= Date.now() ? 'Прошедшее время по правилу · проведение не подтверждено' : 'Постоянное расписание'} · {dayLabel.format(new Date(panel.value.summary.startsAt))}</p><SessionDetails session={panel.value.summary} headingLevel={3} showCapacity={false} /></>
          ) : panel.kind === 'permanent' ? (
            <fieldset className="permission-editor" disabled={accessLost}>
              <PermanentSchedule date={date} rule={panel.rule} onClose={() => setPanel(null)} onChanged={load}
                registerClose={(handler) => { closeSession.current = handler; }} />
            </fieldset>
          ) : panel.kind === 'ages' ? (
            <fieldset className="permission-editor" disabled={accessLost}>
              <AgeDirections
                onClose={() => setPanel(null)}
                registerClose={(handler) => {
                  closeSession.current = handler;
                }}
              />
            </fieldset>
          ) : panel.kind === 'groups' && !canScheduleEdit && !opened.current.editable ? (
            <ScheduleGroupsReadOnly groups={groups} />
          ) : panel.kind === 'groups' ? (
            <fieldset className="permission-editor" disabled={accessLost}>
              <RecurringGroups
                date={date}
                initialDirty={panel.initialDirty}
                initialInput={panel.initialInput}
                initialSeriesId={panel.initialSeriesId}
                boundary={panel.boundary}
                onChanged={load}
                onClose={() => setPanel(null)}
                registerClose={(handler) => {
                  closeSession.current = handler;
                }}
              />
            </fieldset>
          ) : panel.kind === 'session' &&
            !canScheduleEdit &&
            !opened.current.editable &&
            panel.value ? (
            <ScheduleSessionReadOnly session={panel.value} />
          ) : panel.kind === 'session' ? (
            <fieldset className="permission-editor" disabled={accessLost}>
              <AdminSession
                session={panel.value}
                proposed={panel.proposed}
                proposedDuration={panel.proposedDuration}
                groups={groups}
                membership={calendarContext.memberships.find(
                  (m) => m.sessionId === panel.value?.id,
                )}
                onRepeat={(input, unsaved) => {
                  const member = calendarContext.memberships.find(
                    (m) => m.sessionId === panel.value?.id,
                  );
                  setPanel({
                    kind: 'groups',
                    initialDirty: unsaved,
                    initialInput: input,
                    initialSeriesId: member?.seriesId ?? undefined,
                    boundary: member?.originalDate ?? undefined,
                  });
                }}
                selectedDate={date}
                onCalendarChanged={load}
                onSeriesEdit={(id) => setPanel({ kind: 'groups', initialSeriesId: id })}
                onClose={() => setPanel(null)}
                registerClose={(handler) => {
                  closeSession.current = handler;
                }}
                onSaved={async (value, displayDate) => {
                  if (panelRef.current !== panel) {
                    await load();
                    return;
                  }
                  setSelectedId(value.id);
                  setDate(dateKey(displayDate ?? value.startsAt));
                  setPanel({ kind: 'session', value });
                  await load();
                }}
              />
            </fieldset>
          ) : panel.kind === 'enquiry' ? (
            <>
              <p>
                {panel.value.parentName} · {panel.value.phone}
              </p>
              {'participantType' in panel.value && panel.value.participantType === 'SELF' ? (
                <p>
                  Для себя
                  {'participantAge' in panel.value && typeof panel.value.participantAge === 'number'
                    ? `, возраст: ${panel.value.participantAge}`
                    : ''}
                </p>
              ) : null}
              {panel.value.childName || panel.value.childAge != null ? (
                <p>
                  {panel.value.childName ?? 'Имя ребёнка не указано'}
                  {panel.value.childAge != null ? `, возраст: ${panel.value.childAge}` : ''}
                </p>
              ) : null}
              <p>{panel.value.desiredSessionSnapshot ?? 'Без выбранного занятия'}</p>
              <p>{panel.value.comment}</p>
              <p>
                Доставка в Telegram:{' '}
                {delivery
                  ? delivery.status === 'NOT_SELECTED'
                    ? 'Канал не был выбран'
                    : delivery.status === 'DELIVERED'
                      ? 'Доставлено'
                      : !delivery.configured
                        ? 'Ожидает настройки бота'
                        : delivery.status === 'FAILED'
                          ? delivery.error === 'CHAT_MIGRATED'
                            ? 'Чат перемещён; оператору нужно обновить настройку бота.'
                            : 'Не удалось доставить'
                          : 'Ожидает отправки'
                  : 'Проверяем…'}
              </p>
              <p>
                Уведомления браузера:{' '}
                {!pushDelivery
                  ? 'Проверяем…'
                  : !pushDelivery.selected
                    ? 'Канал не был выбран'
                    : !pushDelivery.configured
                      ? 'Сервис не настроен'
                      : !pushDelivery.subscriptions
                        ? 'Нет подключённых устройств'
                        : `Принято сервисом: ${pushDelivery.accepted}; ожидают: ${pushDelivery.waiting}; ошибки или отключения: ${pushDelivery.failed}. Показ не подтверждён.`}
              </p>
              {delivery?.status === 'FAILED' ? (
                <button className="button" onClick={() => void retry(panel.value.id)}>
                  Повторить доставку
                </button>
              ) : null}
              {canPaymentEdit ? (
                <button
                  className="button light"
                  onClick={() => setPanel({ kind: 'payment', value: null, source: panel.value })}
                >
                  Подготовить оплату
                </button>
              ) : null}
              <p>Проверьте контакты перед сохранением оплаты.</p>
            </>
          ) : (!canPaymentEdit || panel.readOnly) && !opened.current.editable && panel.value ? (
            <div>
              <p>{panel.value.purpose}</p>
              <p>
                {(panel.value.amountMinor / 100).toLocaleString('ru-RU', {
                  style: 'currency',
                  currency: 'RUB',
                })}
              </p>
              <p>
                {panel.value.recipientName} · {panel.value.phone}
              </p>
            </div>
          ) : (
            <fieldset className="permission-editor" disabled={accessLost}>
              <PaymentForm value={panel.value} source={panel.source} onSaved={saved} />
            </fieldset>
          )}
        </Panel>
      ) : null}
    </Workspace>
  );
}
function PaymentForm({
  value,
  source,
  onSaved,
}: {
  value: Payment | null;
  source?: Enquiry;
  onSaved: (text: string) => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFields({});
    const d = new FormData(e.currentTarget);
    try {
      const amount = String(d.get('amount')).replace(',', '.');
      if (!/^\d+(?:\.\d{1,2})?$/.test(amount))
        throw new UserFacingError('Укажите сумму с точностью до копейки.');
      const [rub, kop = ''] = amount.split('.');
      const phone = phoneFromForm(d);
      if (phone === null) throw new UserFacingError(uiText.phoneIncomplete);
      const body = {
        amountMinor: Number(rub) * 100 + Number(kop.padEnd(2, '0')),
        purpose: String(d.get('purpose')),
        recipientName: String(d.get('recipientName')),
        phone,
        enquiryId: value?.enquiryId ?? source?.id ?? null,
        expectedVersion: value?.version,
      };
      const headers = await csrf();
      const r = value
        ? await api.PUT('/api/v1/admin/payment-requests/{id}', {
            params: { path: { id: value.id } },
            headers,
            body,
          })
        : await api.POST('/api/v1/admin/payment-requests', { headers, body });
      if (r.error) throw r.error;
      await onSaved('Черновик оплаты сохранён.');
    } catch (e) {
      setFields(publicFields(e));
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="payment-content">
      {busy ? <p role="status">Сохраняем черновик оплаты…</p> : null}
      <RussianForm onSubmit={save} className="stack">
        <label>
          Сумма в рублях
          <input
            aria-invalid={!!fields.amountMinor}
            aria-describedby="amount-error"
            name="amount"
            inputMode="decimal"
            required
            defaultValue={value ? (value.amountMinor / 100).toFixed(2) : ''}
          />
        </label>
        <p id="amount-error" className="field-error">
          {fields.amountMinor}
        </p>
        <label>
          Назначение
          <input
            aria-invalid={!!fields.purpose}
            aria-describedby="purpose-error"
            name="purpose"
            required
            maxLength={300}
            defaultValue={value?.purpose}
          />
        </label>
        <p id="purpose-error" className="field-error">
          {fields.purpose}
        </p>
        <label>
          Имя получателя
          <input
            aria-invalid={!!fields.recipientName}
            aria-describedby="recipient-error"
            name="recipientName"
            required
            maxLength={100}
            defaultValue={value?.recipientName ?? source?.parentName}
          />
        </label>
        <p id="recipient-error" className="field-error">
          {fields.recipientName}
        </p>
        <PhoneInput
          defaultValue={value?.phone ?? source?.phone}
          errorId="payment-phone-error"
          invalid={!!fields.phone}
        />
        <p id="payment-phone-error" className="field-error">
          {fields.phone}
        </p>
        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="button" disabled={busy}>
          Сохранить черновик
        </button>
      </RussianForm>
      <p>Сохраните черновик. Тестовую ссылку можно создать в списке активных оплат.</p>
      <button type="button" className="button light" disabled>
        Создать платёжную ссылку
      </button>
    </div>
  );
}
