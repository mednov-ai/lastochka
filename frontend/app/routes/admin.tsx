import { EditorCommandStatus } from '../ui/editor-command-status';
import { EnquiryRow, EnquiryDetails } from '../ui/admin-enquiry';
import { EnquiryNotifications } from '../ui/enquiry-notifications';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router';
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
type VkDelivery = components['schemas']['VkDeliveryView'];
const enquiryIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const enquiryPageSize = 25;
const maxEnquiryPage = Math.floor(2_147_483_647 / enquiryPageSize);
export default function Admin() {
  const { section } = useParams();
  const [search, setSearch] = useSearchParams();
  const linkedEnquiry = section === 'requests' ? search.get('enquiry') : null;
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
  const pageParam = section === 'requests' ? search.get('page') : null;
  const pageNumber = pageParam && /^[1-9]\d*$/.test(pageParam) ? Number(pageParam) : 1;
  const page = pageNumber <= maxEnquiryPage + 1 ? pageNumber - 1 : 0;
  const [enquiryResult, setEnquiryResult] = useState<{ page: number; total: number; items: Enquiry[] } | null>(null);
  const currentEnquiries = enquiryResult?.page === page ? enquiryResult : null;
  const lastEnquiryPage = Math.max(0, Math.ceil((currentEnquiries?.total ?? 0) / enquiryPageSize) - 1);
  const range = useRef<HTMLParagraphElement>(null);
  const focusPage = useRef<number | null>(null);
  const setEnquiryPage = useCallback((nextPage: number, replace = false) => {
    setSearch((params) => {
      const next = new URLSearchParams(params);
      if (nextPage === 0) next.delete('page');
      else next.set('page', String(nextPage + 1));
      return next;
    }, { replace, preventScrollReset: true });
  }, [setSearch]);
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
  const [vkError, setVkError] = useState('');
  const [vkDelivery, setVkDelivery] = useState<VkDelivery | null>(null);
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
        setEnquiryResult({ page, items: r.data.items, total: r.data.total });
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
    if (section !== 'requests' || !allowed) return;
    const target = currentEnquiries ? Math.min(page, lastEnquiryPage) : page;
    if (pageParam !== (target === 0 ? null : String(target + 1))) {
      if (focusPage.current === page) focusPage.current = target;
      setEnquiryPage(target, true);
    }
  }, [allowed, currentEnquiries, lastEnquiryPage, page, pageParam, section, setEnquiryPage]);
  useEffect(() => {
    if (section !== 'requests' || loading || error || !currentEnquiries ||
      page > lastEnquiryPage || focusPage.current !== page) return;
    focusPage.current = null;
    range.current?.focus({ preventScroll: true });
    range.current?.scrollIntoView({ block: 'start' });
  }, [currentEnquiries, error, lastEnquiryPage, loading, page, section]);
  useEffect(() => {
    deliveryGeneration.current++;
    setPanel(null);
    focusPage.current = null;
    setNotice('');
  }, [section]);
  async function saved(text: string) {
    setPanel(null);
    setNotice(text);
    await load();
  }
  const openEnquiry = useCallback(async (value: Enquiry) => {
    const request = ++deliveryGeneration.current;
    setPanel({ kind: 'enquiry', value });
    setTelegramError('');
    setVkError('');
    setVkDelivery(null);
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
        if (request === deliveryGeneration.current) setError(message(error, { announce: false }));
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
        api.GET('/api/v1/admin/enquiries/{id}/vk-delivery', { params }),
        setVkDelivery,
        setVkError,
      ),
      loadChannel(
        api.GET('/api/v1/admin/enquiries/{id}/browser-push', { params }),
        setPushDelivery,
        setPushError,
      ),
    ]);
  }, []);
  useEffect(() => {
    if (!allowed || !linkedEnquiry) return;
    if (!enquiryIdPattern.test(linkedEnquiry)) {
      setNotice('Ссылка на заявку недействительна.');
      return;
    }
    let live = true;
    const controller = new AbortController();
    void api.GET('/api/v1/admin/enquiries/{id}', {
      params: { path: { id: linkedEnquiry } }, signal: controller.signal,
    }).then((result) => {
      if (!live) return;
      if (result.error || !result.data) throw result.error;
      void openEnquiry(result.data);
    }).catch((failure: unknown) => {
      if (live) setNotice(message(failure));
    });
    return () => { live = false; controller.abort(); };
  }, [allowed, linkedEnquiry, openEnquiry]);
  async function retry(id: string) {
    const request = deliveryGeneration.current;
    try {
      const r = await api.POST('/api/v1/admin/enquiries/{id}/vk-delivery/retry', {
        params: { path: { id } },
        headers: await csrf(),
      });
      if (request !== deliveryGeneration.current) return;
      if (r.error) throw r.error;
      setVkError('');
      setVkDelivery(r.data);
    } catch (e) {
      if (request === deliveryGeneration.current) setVkError(message(e, { announce: false }));
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
        <div className="notice error" role="alert">{error}{section === 'schedule' || section === 'requests' ? <button type="button" className="button light" onClick={() => void load()}>Повторить загрузку</button> : null}</div>
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
          <div className="enquiry-register-header">
            {auth?.account?.id ? (
              <EnquiryNotifications
                accountId={auth.account.id}
                canManage={auth.account.role === 'ADMIN'}
              />
            ) : null}
            <p ref={range} role="status" tabIndex={-1} className="enquiry-register-range">
              {currentEnquiries && page <= lastEnquiryPage && currentEnquiries.items.length > 0
                ? `${page * enquiryPageSize + 1}–${page * enquiryPageSize + currentEnquiries.items.length} из ${currentEnquiries.total}`
                : ''}
            </p>
          </div>
          {currentEnquiries && page <= lastEnquiryPage ? (
            <>
              {currentEnquiries.items.length > 0 ? (
                <div className="enquiry-list">
                  {currentEnquiries.items.map((e) => <EnquiryRow key={e.id} value={e} open={() => void openEnquiry(e)} />)}
                </div>
              ) : !loading && !error ? <p>Заявок пока нет.</p> : null}
              <div className="enquiry-register-footer">
                <Pager label="Заявки" showSinglePage page={page} total={currentEnquiries.total} size={enquiryPageSize} onChange={(nextPage) => {
                  focusPage.current = nextPage;
                  setEnquiryPage(nextPage);
                }} />
              </div>
            </>
          ) : null}
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
            if (panel.kind === 'enquiry' && linkedEnquiry)
              setSearch((params) => {
                const next = new URLSearchParams(params);
                next.delete('enquiry');
                return next;
              }, { replace: true });
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
            <EnquiryDetails value={panel.value} delivery={delivery} vk={vkDelivery} vkLoadError={vkError} push={pushDelivery} telegramError={telegramError} pushError={pushError}
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
