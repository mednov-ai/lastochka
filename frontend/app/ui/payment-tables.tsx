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
  onOpen: (payment: Payment, readOnly: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const [busyPaymentId, setBusyPaymentId] = useState<string | null>(null);
  const busy = busyPaymentId !== null;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [link, setLink] = useState('');
  const permission = useRef({ canEdit, version: 0 });
  if (permission.current.canEdit !== canEdit) {
    permission.current = { canEdit, version: permission.current.version + 1 };
  }
  useEffect(() => {
    if (!canEdit) setLink('');
  }, [canEdit]);

  async function run(payment: Payment, operation: Operation) {
    const permissionVersion = permission.current.version;
    setBusyPaymentId(payment.id);
    setError('');
    setNotice('');
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
        setLink(result.data.url);
        setNotice('Тестовая ссылка готова. Не отправляйте её для реальной оплаты.');
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
      setNotice(
        operation === 'archive'
          ? 'Запись перенесена в архив.'
          : 'Запрос выполнен. Проверьте состояние платежа в таблице.',
      );
    } catch (exception) {
      setError(message(exception));
      await onChanged();
    } finally {
      setBusyPaymentId(null);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setNotice('Тестовая ссылка скопирована.');
    } catch {
      setError('Не удалось скопировать ссылку. Выделите и скопируйте её вручную.');
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
                      {payment.snapshotPurpose ? (
                        <small>В тестовом заказе: {payment.snapshotPurpose}</small>
                      ) : null}
                    </th>
                    <td>{payment.recipientName}</td>
                    <td>
                      {(payment.amountMinor / 100).toLocaleString('ru-RU', {
                        style: 'currency',
                        currency: 'RUB',
                      })}
                      {payment.snapshotAmountMinor != null ? (
                        <small>
                          В тестовом заказе:{' '}
                          {(payment.snapshotAmountMinor / 100).toLocaleString('ru-RU', {
                            style: 'currency',
                            currency: 'RUB',
                          })}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      {status(payment)}
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
                    <td>
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
                        {canEdit && !isArchived && payment.paymentLinkIssuanceAvailable ? (
                          <button
                            type="button"
                            className="button light"
                            disabled={busy}
                            onClick={() => void run(payment, 'issue')}
                          >
                            Создать тестовую ссылку
                          </button>
                        ) : null}
                        {canEdit &&
                        !isArchived &&
                        !payment.operationState &&
                        !payment.paymentLinkIssuanceAvailable ? (
                          <span>Тестовая ссылка пока недоступна.</span>
                        ) : null}
                        {canEdit && payment.linkAvailable ? (
                          <button
                            type="button"
                            className="button light"
                            disabled={busy}
                            onClick={() => void run(payment, 'link')}
                          >
                            Показать тестовую ссылку
                          </button>
                        ) : null}
                        {canEdit && payment.canRefresh ? (
                          <button
                            type="button"
                            className="button light"
                            disabled={busy}
                            onClick={() => void run(payment, 'refresh')}
                          >
                            Проверить состояние
                          </button>
                        ) : null}
                        {canEdit && payment.canCancel ? (
                          <button
                            type="button"
                            className="button light"
                            disabled={busy}
                            onClick={() => void run(payment, 'cancel')}
                          >
                            Отменить платёж
                          </button>
                        ) : null}
                        {canEdit && payment.canArchive ? (
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
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
      {canEdit && link ? (
        <div className="payment-test-link">
          <label htmlFor="payment-test-link">Тестовая ссылка</label>
          <textarea id="payment-test-link" readOnly value={link} />
          <button type="button" className="button light" onClick={() => void copyLink()}>
            Скопировать
          </button>
          <button type="button" className="button light" onClick={() => setLink('')}>
            Скрыть ссылку
          </button>
        </div>
      ) : null}
      {table('Активные оплаты', active, false)}
      {table('Архивные оплаты', archived, true)}
    </>
  );
}
