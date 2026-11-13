import { useEffect, useRef, useState } from 'react';
import { api, csrf, message } from '../api/client';
import type { components } from '../api/schema';
import { Pager } from './pager';
import { moscow } from './workspace';

type Payment = components['schemas']['PaymentView'];
type Operation = 'issue' | 'refresh' | 'cancel' | 'archive' | 'link';

function status(payment: Payment): string {
  if (payment.operationState === 'UNKNOWN' || payment.operationState === 'CANCEL_UNKNOWN')
    return 'Результат уточняется';
  if (payment.operationState === 'REGISTERING') return 'Создание платежа';
  if (payment.operationState === 'PAID') return 'Оплачен';
  if (payment.operationState === 'CANCELLED') return 'Отменён';
  if (payment.operationState === 'DECLINED') return 'Отказ в оплате';
  switch (payment.bankStatus) {
    case 'REGISTERED':
    case 'PENDING':
    case '0':
      return 'Ожидает оплаты';
    case 'PAID':
    case '2':
      return 'Оплачен';
    case 'CANCELLED':
      return 'Отменён';
    case 'DECLINED':
    case '6':
      return 'Отказ в оплате';
    case 'AUTHORIZED':
    case '1':
      return 'Оплата проверяется';
    case '5':
      return 'Подтверждение оплаты';
    case null:
    case undefined:
      return payment.operationState ? 'Ожидает проверки' : 'Черновик';
    default:
      return 'Состояние уточняется';
  }
}

export function PaymentTables({
  active,
  archived,
  activePage,
  archivedPage,
  activeTotal,
  archivedTotal,
  onActivePage,
  onArchivedPage,
  canEdit,
  accountId,
  onActionStart,
  onOpen,
  onChanged,
}: {
  active: Payment[];
  archived: Payment[];
  activePage: number;
  archivedPage: number;
  activeTotal: number;
  archivedTotal: number;
  onActivePage: (page: number) => void;
  onArchivedPage: (page: number) => void;
  canEdit: boolean;
  accountId: string;
  onActionStart: () => void;
  onOpen: (payment: Payment, readOnly: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const [busyPaymentId, setBusyPaymentId] = useState<string | null>(null);
  const busy = busyPaymentId !== null;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [movedToArchive, setMovedToArchive] = useState(false);
  const [selectedTab, setSelectedTab] = useState<'active' | 'archived'>('active');
  const activeTab = useRef<HTMLButtonElement>(null);
  const archivedTab = useRef<HTMLButtonElement>(null);
  const linkTrigger = useRef<HTMLElement | null>(null);
  const [link, setLink] = useState('');
  const [linkPermissionVersion, setLinkPermissionVersion] = useState(-1);
  const [linkEnvironment, setLinkEnvironment] = useState<'TEST' | 'PRODUCTION' | null>(null);
  const permission = useRef({ canEdit, accountId, version: 0 });
  if (permission.current.canEdit !== canEdit || permission.current.accountId !== accountId) {
    permission.current = { canEdit, accountId, version: permission.current.version + 1 };
  }
  useEffect(() => {
    setLink('');
  }, [canEdit, accountId]);
  useEffect(() => () => { permission.current.version += 1; }, []);

  async function run(payment: Payment, operation: Operation, trigger?: HTMLElement) {
    if (
      operation === 'issue' &&
      payment.availableGatewayEnvironment !== 'TEST' &&
      payment.availableGatewayEnvironment !== 'PRODUCTION'
    )
      return;
    if (
      operation === 'link' &&
      payment.gatewayEnvironment !== 'TEST' &&
      payment.gatewayEnvironment !== 'PRODUCTION'
    )
      return;
    if (
      operation === 'issue' &&
      payment.availableGatewayEnvironment === 'PRODUCTION' &&
      !window.confirm(
        'Создать настоящую ссылку для оплаты? По ней можно совершить реальный платёж.',
      )
    )
      return;
    const permissionVersion = permission.current.version;
    if (operation === 'link') linkTrigger.current = trigger ?? null;
    setBusyPaymentId(payment.id);
    onActionStart();
    setError('');
    setNotice('');
    setMovedToArchive(false);
    setLink('');
    try {
      const headers = await csrf();
      const params = { path: { id: payment.id } };
      const body = { expectedVersion: payment.version };
      if (operation === 'link') {
        const result = await api.POST('/api/v1/admin/payment-requests/{id}/link', {
          params,
          headers,
        });
        if (result.error) throw result.error;
        if (!permission.current.canEdit || permission.current.version !== permissionVersion) return;
        setLinkPermissionVersion(permissionVersion);
        setLink(result.data.url);
        setLinkEnvironment(payment.gatewayEnvironment === 'PRODUCTION' ? 'PRODUCTION' : 'TEST');
        return;
      }
      const result =
        operation === 'issue'
          ? await api.POST('/api/v1/admin/payment-requests/{id}/issue', { params, headers, body })
          : operation === 'refresh'
            ? await api.POST('/api/v1/admin/payment-requests/{id}/refresh', {
                params,
                headers,
                body,
              })
            : operation === 'cancel'
              ? await api.POST('/api/v1/admin/payment-requests/{id}/cancel', {
                  params,
                  headers,
                  body,
                })
              : await api.POST('/api/v1/admin/payment-requests/{id}/archive', {
                  params,
                  headers,
                  body,
                });
      if (result.error) throw result.error;
      await onChanged();
      const moved = !payment.archived && (operation === 'archive' || result.data.archived);
      setMovedToArchive(!!moved);
      setNotice(moved ? 'Запись перенесена в архив.' : 'Запрос выполнен. Проверьте состояние платежа в таблице.');
    } catch (exception) {
      setError(message(exception));
      await onChanged();
    } finally {
      setBusyPaymentId(null);
    }
  }

  function table(title: string, payments: Payment[], isArchived: boolean) {
    return (
      <section className="payment-table-section" aria-label={title}>
        <h2>{title}</h2>
        {payments.length ? (
          <div
            className="payment-table-scroll"
            role="region"
            aria-label={`${title}: таблица`}
            tabIndex={0}
          >
            <table className="payment-table">
              <thead>
                <tr>
                  <th scope="col">Назначение</th>
                  <th scope="col">Получатель</th>
                  <th scope="col">Сумма</th>
                  <th scope="col">Состояние</th>
                  <th scope="col">Действия</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <th scope="row">
                      {payment.purpose}
                      {payment.snapshotPurpose != null && payment.snapshotPurpose !== payment.purpose ? (
                        <small>В заказе: {payment.snapshotPurpose}</small>
                      ) : null}
                    </th>
                    <td data-label="Получатель">{payment.recipientName}</td>
                    <td data-label="Сумма">
                      {(payment.amountMinor / 100).toLocaleString('ru-RU', {
                        style: 'currency',
                        currency: 'RUB',
                      })}
                      {payment.snapshotAmountMinor != null && payment.snapshotAmountMinor !== payment.amountMinor ? (
                        <small>
                          В заказе:{' '}
                          {(payment.snapshotAmountMinor / 100).toLocaleString('ru-RU', {
                            style: 'currency',
                            currency: 'RUB',
                          })}
                        </small>
                      ) : null}
                    </td>
                    <td data-label="Состояние">
                      {status(payment)}
                      {payment.gatewayEnvironment === 'TEST' ? (
                        <small>Тестовая оплата</small>
                      ) : payment.gatewayEnvironment === 'PRODUCTION' ? (
                        <small>Реальная оплата</small>
                      ) : payment.operationState ? (
                        <small className="field-error">Среда платежа неизвестна</small>
                      ) : null}
                      {payment.bankCheckedAt ? (
                        <small>Проверено: {moscow(payment.bankCheckedAt)}</small>
                      ) : payment.operationState ? (
                        <small>Ещё не подтверждено банком</small>
                      ) : null}
                      {payment.bankError ? (
                        <small className="field-error">
                          Не удалось обновить состояние в банке.
                        </small>
                      ) : null}
                    </td>
                    <td data-label="Действия">
                      <div className="payment-row-actions">
                        {busyPaymentId === payment.id ? (
                          <p role="status">Выполняем действие с оплатой…</p>
                        ) : null}
                        <button
                          type="button"
                          className="button light"
                          onClick={() => onOpen(payment, isArchived)}
                        >
                          {canEdit && !isArchived ? 'Изменить черновик' : 'Просмотреть'}
                        </button>
                        {canEdit && !isArchived && payment.paymentLinkIssuanceAvailable &&
                        (payment.availableGatewayEnvironment === 'TEST' ||
                          payment.availableGatewayEnvironment === 'PRODUCTION') ? (
                          <button
                            type="button"
                            className="button light"
                            disabled={busy}
                            onClick={() => void run(payment, 'issue')}
                          >
                            {payment.availableGatewayEnvironment === 'PRODUCTION'
                              ? 'Создать ссылку на оплату'
                              : 'Создать тестовую ссылку'}
                          </button>
                        ) : null}
                        {canEdit &&
                        !isArchived &&
                        !payment.operationState &&
                        (!payment.paymentLinkIssuanceAvailable ||
                          (payment.availableGatewayEnvironment !== 'TEST' &&
                            payment.availableGatewayEnvironment !== 'PRODUCTION')) ? (
                          <span>Создание ссылки пока недоступно.</span>
                        ) : null}
                        {canEdit &&
                        payment.linkAvailable &&
                        (payment.gatewayEnvironment === 'TEST' ||
                          payment.gatewayEnvironment === 'PRODUCTION') ? (
                          <button
                            type="button"
                            className="button light"
                            disabled={busy}
                            onClick={(event) => void run(payment, 'link', event.currentTarget)}
                          >
                            {payment.gatewayEnvironment === 'PRODUCTION'
                              ? 'Показать ссылку на оплату'
                              : 'Показать тестовую ссылку'}
                          </button>
                        ) : null}
                        {canEdit &&
                        payment.canRefresh &&
                        (payment.gatewayEnvironment === 'TEST' ||
                          payment.gatewayEnvironment === 'PRODUCTION') ? (
                          <button
                            type="button"
                            className="button light"
                            disabled={busy}
                            onClick={() => void run(payment, 'refresh')}
                          >
                            Проверить состояние
                          </button>
                        ) : null}
                        {canEdit &&
                        payment.canCancel &&
                        (payment.gatewayEnvironment === 'TEST' ||
                          payment.gatewayEnvironment === 'PRODUCTION') ? (
                          <button
                            type="button"
                            className="button light"
                            disabled={busy}
                            onClick={() => void run(payment, 'cancel')}
                          >
                            Отменить платёж
                          </button>
                        ) : null}
                        {canEdit &&
                        payment.canArchive &&
                        (payment.gatewayEnvironment === 'TEST' ||
                          payment.gatewayEnvironment === 'PRODUCTION') ? (
                          <button
                            type="button"
                            className="button light"
                            disabled={busy}
                            onClick={() => void run(payment, 'archive')}
                          >
                            В архив
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>{isArchived ? 'Архивных оплат пока нет.' : 'Активных оплат пока нет.'}</p>
        )}
        <Pager
          label={title}
          page={isArchived ? archivedPage : activePage}
          total={isArchived ? archivedTotal : activeTotal}
          size={20}
          onChange={isArchived ? onArchivedPage : onActivePage}
        />
      </section>
    );
  }

  return (
    <>
      {error ? (
        <p className="notice error" data-page-error="true" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="payment-feedback" role="status">
          {notice}
          {movedToArchive && selectedTab === 'active' ? <button type="button" className="payment-feedback-link" onClick={() => { setSelectedTab('archived'); archivedTab.current?.focus(); }}>Открыть архив</button> : null}
        </p>
      ) : null}
      {canEdit && link && linkPermissionVersion === permission.current.version ? (
        <PaymentLinkDialog link={link} environment={linkEnvironment} trigger={linkTrigger.current} fallback={selectedTab === 'active' ? activeTab : archivedTab} onClose={() => setLink('')} />
      ) : null}
      <div className="payment-tabs" role="tablist" aria-label="Категории оплат" onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'active' : event.key === 'End' ? 'archived' : selectedTab === 'active' ? 'archived' : 'active';
        setSelectedTab(next);
        (next === 'active' ? activeTab : archivedTab).current?.focus();
      }}>
        <button type="button" role="tab" id="payment-tab-active" aria-controls="payment-panel-active" aria-selected={selectedTab === 'active'} tabIndex={selectedTab === 'active' ? 0 : -1} ref={activeTab} onClick={() => setSelectedTab('active')}>Активные <span>{activeTotal}</span></button>
        <button type="button" role="tab" id="payment-tab-archived" aria-controls="payment-panel-archived" aria-selected={selectedTab === 'archived'} tabIndex={selectedTab === 'archived' ? 0 : -1} ref={archivedTab} onClick={() => setSelectedTab('archived')}>Архивные <span>{archivedTotal}</span></button>
      </div>
      <div role="tabpanel" id="payment-panel-active" aria-labelledby="payment-tab-active" hidden={selectedTab !== 'active'} tabIndex={0}>{selectedTab === 'active' ? table('Активные оплаты', active, false) : null}</div>
      <div role="tabpanel" id="payment-panel-archived" aria-labelledby="payment-tab-archived" hidden={selectedTab !== 'archived'} tabIndex={0}>{selectedTab === 'archived' ? table('Архивные оплаты', archived, true) : null}</div>
    </>
  );
}

function PaymentLinkDialog({ link, environment, trigger, fallback, onClose }: {
  link: string;
  environment: 'TEST' | 'PRODUCTION' | null;
  trigger: HTMLElement | null;
  fallback: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [feedback, setFeedback] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    el.showModal();
    el.querySelector<HTMLElement>('[data-link-heading]')?.focus();
    return () => {
      el.close();
      const target = trigger?.isConnected && !trigger.hasAttribute('disabled') ? trigger : fallback.current;
      target?.focus({ preventScroll: true });
    };
  }, [trigger, fallback]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setFailed(false);
      setFeedback('Ссылка скопирована.');
    } catch {
      setFailed(true);
      setFeedback('Не удалось скопировать ссылку. Выделите и скопируйте её вручную.');
    }
  }
  const title = environment === 'PRODUCTION' ? 'Ссылка для реальной оплаты' : 'Тестовая ссылка';
  return (
    <dialog ref={dialog} className="payment-link-dialog" aria-labelledby="payment-link-heading" onCancel={(event) => { event.preventDefault(); close.current(); }}>
      <header className="payment-link-heading">
        <h2 id="payment-link-heading" data-link-heading tabIndex={-1}>{title}</h2>
        <button type="button" className="payment-link-close" aria-label="Закрыть окно ссылки" onClick={onClose}>×</button>
      </header>
      <p>{environment === 'TEST' ? 'Не отправляйте тестовую ссылку для реальной оплаты.' : 'По этой ссылке можно совершить реальную оплату.'}</p>
      <label htmlFor="payment-link-value">{title}</label>
      <textarea id="payment-link-value" readOnly value={link} spellCheck={false} />
      {feedback ? <p className={failed ? 'field-error' : 'payment-feedback'} role={failed ? 'alert' : 'status'}>{feedback}</p> : null}
      <div className="payment-link-actions"><button type="button" className="button" onClick={() => void copy()}>Скопировать</button><button type="button" className="button light" onClick={onClose}>Закрыть</button></div>
    </dialog>
  );
}
