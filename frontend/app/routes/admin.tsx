import { EditorCommandStatus } from '../ui/editor-command-status';
import { EnquiryRow, EnquiryDetails } from '../ui/admin-enquiry';
import { EnquiryNotifications } from '../ui/enquiry-notifications';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router';
import { UserFacingError, publicFields } from '../ui/error-feedback';
import { api, csrf, message } from '../api/client';
import type { components } from '../api/schema';
import { Workspace } from '../ui/workspace';
import { useAuth } from '../ui/auth-context';
import { WeeklyEditor } from '../ui/weekly-editor';
import { AgeDirections } from '../ui/age-directions';
import { Panel } from '../ui/panel';
import { Pager } from '../ui/pager';
import { RussianForm } from '../ui/russian-form';
import { PhoneInput } from '../ui/phone-input';
import { phoneFromForm } from '../ui/phone';
import { uiText } from '../ui/ui-texts';
import { can } from '../ui/access';
import { PaymentTables } from '../ui/payment-tables';
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
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
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
    | { kind: 'ages' }
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
        : false);
  const [pushError, setPushError] = useState('');
  const [telegramError, setTelegramError] = useState('');
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [pushDelivery, setPushDelivery] = useState<components['schemas']['PushSummary'] | null>(
    null,
  );
  const generation = useRef(0);
  const closeSession = useRef<(() => void) | null>(null);
  const deliveryGeneration = useRef(0);
  useEffect(() => {
    if (auth?.state === 'FULL' && !allowed && panel && !accessLost) {
      deliveryGeneration.current++;
      setPanel(null);
    }
  }, [auth?.state, allowed, panel, accessLost]);
  const load = useCallback(async () => {
    if (!allowed) return;
    const n = ++generation.current;
    setLoading(true);
    setError('');
    try {
      if (section === 'requests') {
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
  }, [allowed, section, page, activePaymentPage, archivedPaymentPage]);
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
    setTelegramError('');
    setDelivery(null);
    setPushDelivery(null);
    setPushError('');
    async function loadChannel<T>(
      result: Promise<{ data?: T; error?: unknown }>,
      setValue: (value: T) => void,
      setError: (text: string) => void,
    ) {
      try {
        const response = await result;
        if (response.error || !response.data) throw response.error;
        if (request === deliveryGeneration.current) setValue(response.data);
      } catch (error) {
        if (request === deliveryGeneration.current) setError(message(error));
      }
    }
    const params = { path: { id: value.id } };
    await Promise.all([
      loadChannel(
        api.GET('/api/v1/admin/enquiries/{id}/delivery', { params }),
        setDelivery,
        setTelegramError,
      ),
      loadChannel(
        api.GET('/api/v1/admin/enquiries/{id}/browser-push', { params }),
        setPushDelivery,
        setPushError,
      ),
    ]);
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
      setTelegramError('');
      setDelivery(r.data);
    } catch (e) {
      if (request === deliveryGeneration.current) setTelegramError(message(e));
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
              ? 'Оплаты'
              : 'Раздел недоступен'
      }
      action={allowed && section === 'payments' && canPaymentEdit ? (
        <button className="button" onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          setPanel({ kind: 'payment', value: null });
        }}>Создать черновик оплаты</button>
      ) : undefined}
    >
      {allowed ? (
        <EditorCommandStatus onChanged={load} />
      ) : (
        <p className="notice">Доступ к разделу отозван.</p>
      )}
      {error ? (
        <div className="notice error" role="alert">{error}{section === 'schedule' ? <button type="button" className="button light" onClick={() => void load()}>Повторить загрузку</button> : null}</div>
      ) : null}
      {notice ? (
        <p role="status" className={section === 'payments' ? 'payment-feedback' : 'notice'}>
          {notice}
        </p>
      ) : null}
      {loading ? <p role="status">Загрузка…</p> : null}
      {allowed && section === 'schedule' && <WeeklyEditor editable={canScheduleEdit}
        manageAges={auth.account?.role === 'ADMIN' ? () => setPanel({kind:'ages'}) : undefined}
        categoriesOpen={panel?.kind === 'ages'} />}
      {allowed && section === 'requests' ? (
        <>
          <p>Свяжитесь с заявителем, чтобы согласовать первое занятие.</p>
          {allowed && auth?.account?.id ? (
            <EnquiryNotifications
              accountId={auth.account.id}
              canManage={auth.account.role === 'ADMIN'}
            />
          ) : null}
          <div className="enquiry-list">
            {enquiries.map((e) => <EnquiryRow key={e.id} value={e} open={() => void openEnquiry(e)} />)}
          </div>
          {!loading && !enquiries.length ? <p>Заявок пока нет.</p> : null}
          <Pager label="Заявки" page={page} total={total} size={25} onChange={setPage} />
        </>
      ) : null}
      {allowed && section === 'payments' ? (
        <>
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
            accountId={auth?.account?.id ?? ''}
            onActionStart={() => setNotice('')}
            onOpen={(value, readOnly) => setPanel({ kind: 'payment', value, readOnly })}
            onChanged={load}
          />
        </>
      ) : null}
      {panel ? (
        <Panel
          payment={panel.kind === 'payment'}
          key={panel.kind}
          title={panel.kind === 'ages' ? 'Возрастные направления' : panel.kind === 'enquiry'
            ? `Заявка №${panel.value.number}` : 'Черновик оплаты'}
          onClose={() => {
            if (accessLost) {
              setConfirmLostAccess(true);
              return;
            }
            if (panel.kind === 'ages' && closeSession.current) {
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
          {panel.kind === 'ages' ? (
            <fieldset className="permission-editor" disabled={accessLost}>
              <AgeDirections
                onClose={() => setPanel(null)}
                registerClose={(handler) => {
                  closeSession.current = handler;
                }}
              />
            </fieldset>
          ) : panel.kind === 'enquiry' ? (
            <EnquiryDetails value={panel.value} delivery={delivery} push={pushDelivery} telegramError={telegramError} pushError={pushError}
              retry={() => void retry(panel.value.id)}
              preparePayment={canPaymentEdit ? () => setPanel({ kind: 'payment', value: null, source: panel.value }) : undefined}
            />
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
        {source && <p>Проверьте контакты перед сохранением оплаты.</p>}
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
      <p>Сохраните черновик. Ссылку можно создать в списке активных оплат.</p>
      <button type="button" className="button light" disabled>
        Создать платёжную ссылку
      </button>
    </div>
  );
}
