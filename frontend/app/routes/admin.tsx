import { EditorCommandStatus } from '../ui/editor-command-status';
import { EnquiryNotifications } from '../ui/enquiry-notifications';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { UserFacingError, publicFields } from '../ui/error-feedback';
import { api, csrf, message } from '../api/client';
import type { components } from '../api/schema';
import { Workspace, moscow } from '../ui/workspace';
import { useAuth } from '../ui/auth-context';
import { StudioCalendar } from '../ui/studio-calendar';
import { RecurringGroups } from '../ui/recurring-groups';
import { AdminSession } from '../ui/admin-session';
import { Panel } from '../ui/panel';
import { Pager } from '../ui/pager';
import { RussianForm } from '../ui/russian-form';
import { PhoneInput } from '../ui/phone-input';
import { phoneFromForm } from '../ui/phone';
import { uiText } from '../ui/ui-texts';
import { addDays, dateKey, dayStart, monday, dayLabel } from '../ui/calendar-time';
type Session = components['schemas']['SessionView'];
type Enquiry = components['schemas']['EnquiryView'];
type Payment = components['schemas']['PaymentView'];
type Delivery = components['schemas']['DeliveryView'];
export default function Admin() {
  const { section } = useParams();
  const { auth } = useAuth();
  const allowed = auth?.state === 'FULL' && auth.account?.role === 'ADMIN';
  const [date, setDate] = useState(() => dateKey(new Date()));
  const [mode, setMode] = useState<'day' | 'week' | 'list'>('week');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [groups, setGroups] = useState<components['schemas']['ScheduleGroupView'][]>([]);
  const [calendarContext, setCalendarContext] = useState<
    components['schemas']['SeriesCalendarContext']
  >({ memberships: [], drafts: [], warnings: [] });
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<
    | { kind: 'session'; value: Session | null; proposed?: string; proposedDuration?: number }
    | {
        kind: 'groups';
        initialDirty?: boolean;
        initialInput?: components['schemas']['SessionInput'];
        initialSeriesId?: string;
        boundary?: string;
      }
    | { kind: 'enquiry'; value: Enquiry }
    | { kind: 'payment'; value: Payment | null; source?: Enquiry }
    | null
  >(null);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [pushDelivery, setPushDelivery] = useState<components['schemas']['PushSummary'] | null>(
    null,
  );
  const generation = useRef(0);
  const closeSession = useRef<(() => void) | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const deliveryGeneration = useRef(0);
  const from = mode === 'day' ? date : monday(date);
  const load = useCallback(async () => {
    if (!allowed) return;
    const n = ++generation.current;
    setLoading(true);
    setError('');
    setSessions([]);
    try {
      if (section === 'schedule') {
        const query = {
          from: dayStart(from).toISOString(),
          to: dayStart(addDays(from, mode === 'day' ? 1 : 7)).toISOString(),
        };
        const [r, context, groupList] = await Promise.all([
          api.GET('/api/v1/admin/calendar', { params: { query } }),
          api.GET('/api/v1/admin/session-series/calendar', { params: { query } }),
          api.GET('/api/v1/admin/schedule-groups'),
        ]);
        if (n !== generation.current) return;
        if (r.error) throw r.error;
        if (context.error) throw context.error;
        if (groupList.error) throw groupList.error;
        setCalendarContext(context.data);
        setGroups(groupList.data.items);
        setSessions(r.data.items);
      } else if (section === 'requests') {
        const r = await api.GET('/api/v1/admin/enquiries', { params: { query: { page } } });
        if (n !== generation.current) return;
        if (r.error) throw r.error;
        setEnquiries(r.data.items);
        setTotal(r.data.total);
      } else if (section === 'payments') {
        const r = await api.GET('/api/v1/admin/payment-requests', { params: { query: { page } } });
        if (n !== generation.current) return;
        if (r.error) throw r.error;
        setPayments(r.data.items);
        setTotal(r.data.total);
      }
    } catch (e) {
      if (n === generation.current) setError(message(e));
    } finally {
      if (n === generation.current) setLoading(false);
    }
  }, [allowed, section, from, mode, page]);
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
      <EditorCommandStatus onChanged={load} />
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
      {loading ? <p role="status">Загрузка…</p> : null}
      {section === 'schedule' ? (
        <>
          <div className="schedule-toolbar">
            <p className="schedule-period">
              {dayLabel.format(dayStart(from))}
              {mode !== 'day' ? ' — ' + dayLabel.format(dayStart(addDays(from, 6))) : ''}
            </p>
            <div className="schedule-actions">
              <button
                className="button"
                onClick={(e) => {
                  e.currentTarget.focus({ preventScroll: true });
                  setPanel({ kind: 'session', value: null });
                }}
              >
                Создать занятие
              </button>
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
          {!loading && !error ? (
            <StudioCalendar
              date={from}
              selectedDate={date}
              sessions={sessions}
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
      {section === 'requests' ? (
        <>
          <p>Обращения не резервируют места. Свяжитесь с родителем для согласования.</p>
          {allowed && auth?.account?.id ? (
            <EnquiryNotifications accountId={auth.account.id} />
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
      {section === 'payments' ? (
        <>
          <p className="notice">
            Платёжный сервис пока не подключён. Доступно сохранение черновика; выпуск платёжной
            ссылки появится после подключения.
          </p>
          <button
            className="button"
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              setPanel({ kind: 'payment', value: null });
            }}
          >
            Создать черновик оплаты
          </button>
          <div className="stack">
            {payments.map((p) => (
              <article className="list-card" key={p.id}>
                <div>
                  <h2>{p.purpose}</h2>
                  <p>
                    {(p.amountMinor / 100).toLocaleString('ru-RU', {
                      style: 'currency',
                      currency: 'RUB',
                    })}{' '}
                    · {p.recipientName}
                  </p>
                  <p>Черновик</p>
                </div>
                <button
                  className="button light"
                  onClick={(event) => {
                    event.currentTarget.focus({ preventScroll: true });
                    setPanel({ kind: 'payment', value: p });
                  }}
                >
                  Изменить черновик
                </button>
              </article>
            ))}
          </div>
          <Pager label="Оплата" page={page} total={total} size={25} onChange={setPage} />
        </>
      ) : null}
      {panel ? (
        <Panel
          compact={panel.kind === 'session' || panel.kind === 'groups'}
          payment={panel.kind === 'payment'}
          key={panel.kind}
          title={
            panel.kind === 'groups'
              ? 'Группы и повторения'
              : panel.kind === 'session'
                ? panel.value
                  ? panel.value.status === 'CANCELLED'
                    ? 'Просмотр занятия'
                    : 'Изменить занятие'
                  : 'Новое занятие'
                : panel.kind === 'enquiry'
                  ? `Заявка №${panel.value.number}`
                  : 'Черновик оплаты'
          }
          onClose={() => {
            if ((panel.kind === 'session' || panel.kind === 'groups') && closeSession.current) {
              closeSession.current();
              return;
            }
            deliveryGeneration.current++;
            setPanel(null);
          }}
        >
          {panel.kind === 'groups' ? (
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
          ) : panel.kind === 'session' ? (
            <AdminSession
              session={panel.value}
              proposed={panel.proposed}
              proposedDuration={panel.proposedDuration}
              groups={groups}
              membership={calendarContext.memberships.find((m) => m.sessionId === panel.value?.id)}
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
          ) : panel.kind === 'enquiry' ? (
            <>
              <p>
                {panel.value.parentName} · {panel.value.phone}
              </p>
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
              <button
                className="button light"
                onClick={() => setPanel({ kind: 'payment', value: null, source: panel.value })}
              >
                Подготовить оплату
              </button>
              <p>Проверьте контакты перед сохранением оплаты.</p>
            </>
          ) : (
            <PaymentForm value={panel.value} source={panel.source} onSaved={saved} />
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
      <p>Платёжный сервис пока не подключён.</p>
      <button className="button light" disabled>
        Создать платёжную ссылку
      </button>
    </div>
  );
}
