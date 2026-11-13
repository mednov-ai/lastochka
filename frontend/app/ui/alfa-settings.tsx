import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, useSearchParams } from 'react-router';
import { api, csrf, message } from '../api/client';
import type { components } from '../api/schema';
import { sensitiveActionError, useSensitiveConfirmation } from './sensitive-confirmation';
import { RussianForm } from './russian-form';
import { moscow } from './workspace';

type Mode = 'TEST' | 'PRODUCTION';
type TestSettings = components['schemas']['AlfaConfigView'];
type ProductionSettings = components['schemas']['AlfaProductionConfigView'];
type Selection = components['schemas']['AlfaGatewaySelectionView'];

const obstacleText: Record<string, string> = {
  FORBIDDEN: 'Боевой шлюз запрещён настройками этого сайта.',
  IMPLEMENTATION_UNVERIFIED: 'Подключение боевого шлюза ещё проходит проверку.',
  KEY_UNAVAILABLE: 'Ключ шифрования боевых реквизитов недоступен.',
  KEY_REUSED: 'Для боевого и тестового шлюзов должны использоваться разные ключи.',
  PROBE_UNCONFIRMED: 'Проверка боевых реквизитов пока не подтверждена.',
  FISCALIZATION_UNCONFIRMED: 'Готовность фискализации пока не подтверждена.',
  FORM_HOSTS_UNCONFIRMED: 'Адреса платёжной страницы пока не подтверждены.',
  CURRENCY_UNCONFIRMED: 'Валюта боевого шлюза пока не подтверждена.',
  CERTIFICATE_UNAVAILABLE: 'Сертификаты для подключения к банку недоступны.',
  RETURN_URL_UNCONFIRMED: 'Адрес возврата после оплаты не настроен.',
};

export function AlfaSettings() {
  const { ensure, confirmation } = useSensitiveConfirmation();
  const [search, setSearch] = useSearchParams();
  const mode: Mode = search.get('gateway') === 'production' ? 'PRODUCTION' : 'TEST';
  const [test, setTest] = useState<TestSettings | null>(null);
  const [testKnown, setTestKnown] = useState(false);
  const [production, setProduction] = useState<ProductionSettings | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirtyTest, setDirtyTest] = useState(false);
  const [dirtyProduction, setDirtyProduction] = useState(false);
  const pending = useRef(false);
  const generation = useRef(0);
  const dirty = dirtyTest || dirtyProduction;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm('Выйти без сохранения введённых реквизитов?')) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const [testResult, prodResult, selectedResult] = await Promise.all([
        api.GET('/api/v1/admin/alfa-config'),
        api.GET('/api/v1/admin/alfa-production-config'),
        api.GET('/api/v1/admin/alfa-gateway-selection'),
      ]);
      if (current !== generation.current) return;
      if (testResult.error || prodResult.error || selectedResult.error)
        throw testResult.error || prodResult.error || selectedResult.error;
      const knownTest =
        testResult.response.headers.get('X-Lastochka-Alfa-Environment') === 'TEST' &&
        typeof testResult.data.enabled === 'boolean' &&
        typeof testResult.data.configured === 'boolean' &&
        typeof testResult.data.candidatePresent === 'boolean';
      const prod = prodResult.data;
      const validProduction =
        typeof prod.allowed === 'boolean' &&
        typeof prod.enabled === 'boolean' &&
        typeof prod.configured === 'boolean' &&
        typeof prod.candidatePresent === 'boolean' &&
        typeof prod.activationReady === 'boolean' &&
        Array.isArray(prod.obstacles);
      const selected = selectedResult.data;
      const validSelection =
        Object.hasOwn(selected, 'activeEnvironment') &&
        (selected.activeEnvironment === null ||
          selected.activeEnvironment === 'TEST' ||
          selected.activeEnvironment === 'PRODUCTION') &&
        Number.isSafeInteger(selected.revision) &&
        selected.revision >= 0;
      setTestKnown(knownTest);
      setTest(knownTest ? testResult.data : null);
      setProduction(validProduction ? prod : null);
      setSelection(validSelection ? selected : null);
      if (!validProduction || !validSelection)
        setError('Не удалось определить состояние всех шлюзов. Выбор для новых платежей заблокирован.');
    } catch (exception) {
      if (current !== generation.current) return;
      setTestKnown(false);
      setTest(null);
      setProduction(null);
      setSelection(null);
      setError(message(exception));
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);

  async function save(event: React.FormEvent<HTMLFormElement>, target: Mode) {
    event.preventDefault();
    if (pending.current || (target === 'TEST' ? !testKnown : !production?.allowed)) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    let sent = false;
    try {
      if (
        !(await ensure(
          target === 'TEST'
            ? 'сохранить тестовые реквизиты банка'
            : 'сохранить боевые реквизиты банка',
        ))
      )
        return;
      const headers = await csrf();
      sent = true;
      const result =
        target === 'TEST'
          ? await api.POST('/api/v1/admin/alfa-config/candidate', {
              headers,
              body: {
                login: String(values.get('login') ?? ''),
                password: String(values.get('password') ?? ''),
                testConfirmed: values.get('confirmed') === 'on',
              },
            })
          : await api.POST('/api/v1/admin/alfa-production-config/candidate', {
              headers,
              body: {
                login: String(values.get('login') ?? ''),
                password: String(values.get('password') ?? ''),
                productionConfirmed: values.get('confirmed') === 'on',
              },
            });
      if (result.error) throw result.error;
      form.reset();
      if (target === 'TEST') setDirtyTest(false);
      else setDirtyProduction(false);
      setNotice('Реквизиты сохранены для проверки. Шлюз для новых платежей не изменён.');
      await load();
    } catch (exception) {
      setError(sensitiveActionError(exception, sent));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function command(target: Mode, action: 'check' | 'disable') {
    if (pending.current || (target === 'TEST' ? !testKnown : !production?.allowed)) return;
    if (
      action === 'disable' &&
      !window.confirm(`Отключить ${target === 'TEST' ? 'тестовое' : 'боевое'} подключение?`)
    )
      return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    let sent = false;
    try {
      if (
        !(await ensure(
          `${action === 'check' ? 'проверить' : 'отключить'} ${target === 'TEST' ? 'тестовое' : 'боевое'} подключение банка`,
        ))
      )
        return;
      const headers = await csrf();
      sent = true;
      const result =
        target === 'TEST'
          ? action === 'check'
            ? await api.POST('/api/v1/admin/alfa-config/candidate/check', { headers })
            : await api.POST('/api/v1/admin/alfa-config/disable', { headers })
          : action === 'check'
            ? await api.POST('/api/v1/admin/alfa-production-config/candidate/check', { headers })
            : await api.POST('/api/v1/admin/alfa-production-config/disable', { headers });
      if (result.error) throw result.error;
      setNotice(
        action === 'check'
          ? 'Состояние реквизитов обновлено. Если проверка не подтверждена, действующее подключение не изменено.'
          : 'Подключение отключено.',
      );
      await load();
    } catch (exception) {
      setError(sensitiveActionError(exception, sent));
      await load();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function selectGateway(target: Mode | null) {
    if (pending.current || !selection || !production || selection.activeEnvironment === 'UNKNOWN') return;
    if (
      target === 'PRODUCTION' &&
      !window.confirm(
        'Выбрать боевой шлюз? Новые ссылки будут предназначены для реальных платежей.',
      )
    )
      return;
    if (target === null && !window.confirm('Отключить создание новых платёжных ссылок?')) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    let sent = false;
    try {
      if (
        !(await ensure(
          target === null
            ? 'отключить создание новых платежей'
            : `выбрать ${target === 'TEST' ? 'тестовый' : 'боевой'} шлюз для новых платежей`,
        ))
      )
        return;
      const headers = await csrf();
      sent = true;
      const result = await api.POST('/api/v1/admin/alfa-gateway-selection', {
        headers,
        body: {
          environment: target,
          expectedRevision: selection.revision,
          productionConfirmed: target === 'PRODUCTION',
        },
      });
      if (result.error) throw result.error;
      setNotice(
        target === null
          ? 'Новые платёжные ссылки отключены.'
          : `Для новых платежей выбран ${target === 'TEST' ? 'тестовый' : 'боевой'} шлюз.`,
      );
      await load();
    } catch (exception) {
      setError(sensitiveActionError(exception, sent));
      await load();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const currentLabel =
    selection?.activeEnvironment === 'TEST'
      ? test?.enabled && test.configured
        ? 'Тестовый шлюз'
        : 'Тестовый шлюз выбран, но недоступен'
      : selection?.activeEnvironment === 'PRODUCTION'
        ? production?.activationReady
          ? 'Боевой шлюз — реальные платежи'
          : 'Боевой шлюз выбран, но недоступен'
        : selection && selection.activeEnvironment === null
          ? 'Не выбран'
          : 'Не удалось определить';
  const knownSelection = production && selection && selection.activeEnvironment !== 'UNKNOWN';
  const testReady = testKnown && !!test?.enabled && !!test.configured;
  const productionReady = !!production?.allowed && production.activationReady;
  function form(target: Mode) {
    const isTest = target === 'TEST';
    const data = isTest ? test : production;
    const title = isTest ? 'Тестовый' : 'Боевой';
    if (isTest && !testKnown)
      return <p role="status">Не удалось определить тестовую среду. Настройка заблокирована.</p>;
    if (!isTest && !production) return <p role="status">Определяем доступность боевого шлюза…</p>;
    if (!isTest && !production?.allowed)
      return (
        <p className="alfa-settings-unavailable" role="status">
          Боевой шлюз запрещён настройками этого сайта. Сохранение реквизитов и реальные платежи
          недоступны.
        </p>
      );
    return (
      <div className="alfa-settings-layout">
        <div className="alfa-settings-summary">
          <p>
            Укажите {isTest ? 'тестовые' : 'боевые'} реквизиты. Сохранённые данные повторно не
            показываются.
          </p>
          <div aria-live="polite" className="alfa-settings-status">
            <p>
              {data?.configured
                ? data.enabled
                  ? 'Реквизиты проверены и сохранены.'
                  : 'Реквизиты сохранены, подключение отключено.'
                : 'Проверенные реквизиты не настроены.'}
            </p>
            {data?.candidatePresent ? <p>Новые реквизиты ожидают проверки.</p> : null}
            {data?.updatedAt ? <p>Последнее изменение: {moscow(data.updatedAt)}</p> : null}
          </div>
          {!isTest && production?.obstacles.length ? (
            <div className="alfa-settings-obstacles">
              <p>Для включения необходимо:</p>
              <ul>
                {production.obstacles.map((obstacle) => (
                  <li key={obstacle}>{obstacleText[obstacle] ?? 'Проверить настройки сервера.'}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p>Для изменения настроек может потребоваться подтверждение пароля.</p>
        </div>
        <div className="alfa-settings-editor">
          <RussianForm
            onSubmit={(event) => void save(event, target)}
            className="stack"
            onChange={() => (isTest ? setDirtyTest(true) : setDirtyProduction(true))}
          >
            <label>
              {title} логин
              <input name="login" autoComplete="off" spellCheck={false} required maxLength={256} />
            </label>
            <label>
              {title} пароль
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                required
                maxLength={512}
              />
            </label>
            <label>
              <input name="confirmed" type="checkbox" required /> Это{' '}
              {isTest ? 'реквизиты тестовой среды' : 'боевые реквизиты'}
            </label>
            <div className="alfa-settings-actions">
              <button className="button" disabled={busy}>
                Сохранить для проверки
              </button>
              <button
                className="button light"
                type="button"
                disabled={busy || !data?.candidatePresent}
                onClick={() => void command(target, 'check')}
              >
                Проверить реквизиты
              </button>
            </div>
          </RussianForm>
          {!data?.candidatePresent ? (
            <p className="alfa-settings-hint">Проверка доступна после сохранения реквизитов.</p>
          ) : null}
          <button
            className="button light alfa-settings-disable"
            type="button"
            disabled={busy || (!data?.configured && !data?.candidatePresent)}
            onClick={() => void command(target, 'disable')}
          >
            Отключить подключение
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="form-card alfa-settings" aria-labelledby="alfa-settings-title">
      {confirmation}
      <div className="alfa-settings-heading">
        <h2 id="alfa-settings-title">Альфа-Банк</h2>
        <img
          src={`${import.meta.env.BASE_URL}images/alfa-bank.svg`}
          alt=""
          aria-hidden="true"
          width="120"
          height="28"
        />
      </div>
      <div className="alfa-active-mode">
        <div>
          <span>Для новых платежей</span>
          <strong>{currentLabel}</strong>
        </div>
        {knownSelection && selection.activeEnvironment ? (
          <button
            type="button"
            className="button light"
            disabled={busy}
            onClick={() => void selectGateway(null)}
          >
            Отключить новые платежи
          </button>
        ) : null}
      </div>
      <nav className="alfa-gateway-tabs" aria-label="Настройки шлюзов">
        <button
          type="button"
          aria-current={mode === 'TEST' ? 'page' : undefined}
          onClick={() => setSearch({ gateway: 'test' })}
        >
          Тестовый шлюз
        </button>
        <button
          type="button"
          aria-current={mode === 'PRODUCTION' ? 'page' : undefined}
          onClick={() => setSearch({ gateway: 'production' })}
        >
          Боевой шлюз
        </button>
      </nav>
      {busy ? <p role="status">Выполняем действие с настройками подключения…</p> : null}
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
      <div hidden={mode !== 'TEST'}>{form('TEST')}</div>
      <div hidden={mode !== 'PRODUCTION'}>{form('PRODUCTION')}</div>
      {knownSelection && (mode === 'TEST' || production?.allowed) ? (
        <div className="alfa-gateway-select">
          <p>Выбор вкладки не меняет шлюз для новых платежей.</p>
          <button
            type="button"
            className="button"
            disabled={
              busy ||
              selection.activeEnvironment === mode ||
              (mode === 'TEST' ? !testReady : !productionReady)
            }
            onClick={() => void selectGateway(mode)}
          >
            {selection.activeEnvironment === mode
              ? 'Выбран для новых платежей'
              : `Выбрать ${mode === 'TEST' ? 'тестовый' : 'боевой'} шлюз для новых платежей`}
          </button>
        </div>
      ) : null}
    </section>
  );
}
