import { useCallback, useEffect, useRef, useState } from 'react';
import { api, csrf, message } from '../api/client';
import type { components } from '../api/schema';
import { sensitiveActionError, useSensitiveConfirmation } from './sensitive-confirmation';
import { RussianForm } from './russian-form';
import { moscow } from './workspace';

type Settings = components['schemas']['AlfaConfigView'];

export function AlfaSettings() {
  const { ensure, confirmation } = useSensitiveConfirmation();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const actionPending = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const result = await api.GET('/api/v1/admin/alfa-config');
      if (current !== generation.current) return;
      if (result.error) throw result.error;
      setSettings(result.data);
    } catch (exception) {
      if (current === generation.current) setError(message(exception));
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actionPending.current) return;
    actionPending.current = true;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError('');
    setNotice('');
    let sent = false;
    try {
      if (!(await ensure('сохранить тестовые реквизиты банка'))) return;
      const headers = await csrf();
      sent = true;
      const result = await api.POST('/api/v1/admin/alfa-config/candidate', {
        headers,
        body: {
          login: String(values.get('login') ?? ''),
          password: String(values.get('password') ?? ''),
          merchantLogin: String(values.get('merchantLogin') ?? '') || null,
          testConfirmed: values.get('testConfirmed') === 'on',
        },
      });
      if (result.error) throw result.error;
      form.reset();
      setNotice('Реквизиты сохранены для проверки. Действующее подключение не изменено.');
      await load();
    } catch (exception) {
      setError(sensitiveActionError(exception, sent));
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }

  async function command(operation: 'check' | 'disable') {
    if (actionPending.current) return;
    if (operation === 'disable' && !window.confirm('Отключить тестовое подключение Альфа-Банка?'))
      return;
    actionPending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    let sent = false;
    try {
      if (
        !(await ensure(
          operation === 'check'
            ? 'проверить тестовые реквизиты банка'
            : 'отключить тестовое подключение банка',
        ))
      )
        return;
      const headers = await csrf();
      sent = true;
      const result =
        operation === 'check'
          ? await api.POST('/api/v1/admin/alfa-config/candidate/check', { headers })
          : await api.POST('/api/v1/admin/alfa-config/disable', { headers });
      if (result.error) throw result.error;
      setNotice(
        operation === 'check'
          ? result.data.candidateStatus === 'UNVERIFIED'
            ? 'Проверка пока недоступна: подтверждение банка не получено. Новые реквизиты не активированы.'
            : 'Состояние реквизитов показано ниже.'
          : 'Тестовое подключение отключено.',
      );
      await load();
    } catch (exception) {
      setError(sensitiveActionError(exception, sent));
      await load();
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="form-card alfa-settings" aria-labelledby="alfa-settings-title">
      {confirmation}
      <h2 id="alfa-settings-title">Тестовое подключение Альфа-Банка</h2>
      <p>
        Укажите только тестовые реквизиты. Для изменения настроек может потребоваться подтверждение
        пароля. Сохранённые реквизиты повторно не показываются.
      </p>
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
      {settings ? (
        <div aria-live="polite">
          <p>
            {settings.enabled
              ? settings.configured
                ? 'Тестовое подключение настроено.'
                : 'Действующие тестовые реквизиты не настроены.'
              : 'Тестовое подключение выключено.'}
          </p>
          {settings.candidatePresent ? <p>Новые реквизиты ожидают проверки.</p> : null}
          {settings.updatedAt ? <p>Последнее изменение: {moscow(settings.updatedAt)}</p> : null}
        </div>
      ) : !error ? (
        <p role="status">Загрузка настроек…</p>
      ) : null}
      <RussianForm onSubmit={save} className="stack">
        <label>
          Тестовый логин
          <input name="login" autoComplete="off" required maxLength={256} />
        </label>
        <label>
          Тестовый пароль
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            maxLength={512}
          />
        </label>
        <label>
          Логин магазина для отмены
          <input name="merchantLogin" autoComplete="off" maxLength={256} />
        </label>
        <p>Укажите логин магазина, подтверждённый банком. Без него отмена заказа недоступна.</p>
        <label>
          <input name="testConfirmed" type="checkbox" required /> Это реквизиты тестовой среды
        </label>
        <button className="button" disabled={busy}>
          Сохранить для проверки
        </button>
      </RussianForm>
      <div className="alfa-settings-actions">
        <button
          className="button light"
          type="button"
          disabled={busy || !settings?.candidatePresent}
          onClick={() => void command('check')}
        >
          Проверить реквизиты
        </button>
        <button
          className="button light"
          type="button"
          disabled={
            busy || (!settings?.configured && !settings?.candidatePresent && !settings?.enabled)
          }
          onClick={() => void command('disable')}
        >
          Отключить подключение
        </button>
      </div>
    </section>
  );
}
