import { useEffect, useState } from 'react';
import { api, csrf, message } from '../api/client';
import type { components } from '../api/schema';

type Settings = components['schemas']['NotificationSettings'];
type Config = components['schemas']['PushConfigurationView'];

function decodeKey(value: string): Uint8Array<ArrayBuffer> {
  const text = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(text + '='.repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export function EnquiryNotifications({
  accountId,
  canManage = true,
}: {
  accountId: string;
  canManage?: boolean;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [telegram, setTelegram] = useState(false);
  const [push, setPush] = useState(false);
  const [device, setDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const supported =
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;
  const storageKey = `lastochka-push-subscription:${accountId}`;

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const [settingsResult, configResult] = await Promise.all([
          canManage
            ? api.GET('/api/v1/admin/enquiry-notification-settings')
            : Promise.resolve(null),
          api.GET('/api/v1/admin/browser-push/config'),
        ]);
        if (settingsResult?.error) throw settingsResult.error;
        if (configResult.error) throw configResult.error;
        if (!live) return;
        if (settingsResult?.data) {
          setSettings(settingsResult.data);
          setTelegram(settingsResult.data.telegramEnabled);
          setPush(settingsResult.data.browserPushEnabled);
        }
        setConfig(configResult.data);
        if (supported) {
          const registration = await navigator.serviceWorker.getRegistration(
            import.meta.env.BASE_URL,
          );
          const subscription = await registration?.pushManager.getSubscription();
          const id = localStorage.getItem(storageKey);
          if (subscription && id) {
            const status = await api.GET('/api/v1/admin/browser-push/subscriptions/{id}', {
              params: { path: { id } },
            });
            if (status.error) throw status.error;
            const oldKey = subscription.options.applicationServerKey;
            const expected = configResult.data.publicKey
              ? decodeKey(configResult.data.publicKey)
              : null;
            const sameKey =
              !!oldKey &&
              !!expected &&
              new Uint8Array(oldKey).length === expected.length &&
              new Uint8Array(oldKey).every((value, index) => value === expected[index]);
            if (live) setDevice(status.data.active && sameKey);
          } else if (live) setDevice(false);
        }
      } catch (value) {
        if (live) setError(message(value));
      }
    }
    void load();
    return () => {
      live = false;
    };
  }, [accountId, storageKey, supported, canManage]);

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await api.PUT('/api/v1/admin/enquiry-notification-settings', {
        headers: await csrf(),
        body: { ...settings, telegramEnabled: telegram, browserPushEnabled: push },
      });
      if (response.error) throw response.error;
      setSettings(response.data);
      setNotice('Настройки уведомлений сохранены.');
    } catch (value) {
      setError(message(value));
    } finally {
      setBusy(false);
    }
  }

  async function enableDevice() {
    if (!supported || !config?.publicKey) return;
    setBusy(true);
    setError('');
    setNotice('');
    let created: PushSubscription | null = null;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted')
        throw new Error('Разрешение на уведомления не выдано. Измените его в настройках браузера.');
      const base = import.meta.env.BASE_URL;
      await navigator.serviceWorker.register(`${base}push-worker.js`, { scope: base });
      const registration = await navigator.serviceWorker.ready;
      let existing = await registration.pushManager.getSubscription();
      if (existing) {
        const previousId = localStorage.getItem(storageKey);
        const oldKey = existing.options.applicationServerKey;
        const expected = decodeKey(config.publicKey);
        const sameKey =
          !!oldKey &&
          new Uint8Array(oldKey).length === expected.length &&
          new Uint8Array(oldKey).every((value, index) => value === expected[index]);
        if (!previousId || !sameKey) {
          if (previousId) {
            const old = await api.DELETE('/api/v1/admin/browser-push/subscriptions/{id}', {
              params: { path: { id: previousId } },
              headers: await csrf(),
            });
            if (old.error) throw old.error;
            localStorage.removeItem(storageKey);
          }
          await existing.unsubscribe();
          existing = null;
        }
      }
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeKey(config.publicKey),
        }));
      if (!existing) created = subscription;
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth)
        throw new Error('Браузер не предоставил данные подписки.');
      const response = await api.POST('/api/v1/admin/browser-push/subscriptions', {
        headers: await csrf(),
        body: { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
      if (response.error) throw response.error;
      localStorage.setItem(storageKey, response.data.id);
      setDevice(true);
      setNotice('Уведомления на этом устройстве подключены.');
    } catch (value) {
      if (created) await created.unsubscribe().catch(() => false);
      setError(
        value instanceof DOMException
          ? 'Не удалось подключить уведомления. Проверьте разрешения и повторите попытку.'
          : value instanceof Error
            ? value.message
            : message(value),
      );
    } finally {
      setBusy(false);
    }
  }

  async function disableDevice() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const id = localStorage.getItem(storageKey);
      if (!id) throw new Error('Подписка этого устройства не найдена.');
      const response = await api.DELETE('/api/v1/admin/browser-push/subscriptions/{id}', {
        params: { path: { id } },
        headers: await csrf(),
      });
      if (response.error) throw response.error;
      const registration = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
      localStorage.removeItem(storageKey);
      setDevice(false);
      setNotice('Уведомления на этом устройстве отключены.');
    } catch (value) {
      setError(
        value instanceof DOMException
          ? 'Не удалось отключить уведомления. Повторите попытку.'
          : value instanceof Error
            ? value.message
            : message(value),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="enquiry-notifications-title">
      <details className="notification-settings">
        <summary id="enquiry-notifications-title">Уведомления о заявках</summary>
        <div className="form-card stack">
          {canManage ? (
            <>
              <h2>Каналы уведомлений</h2>
              <p>
                Каналы выбираются для всех администраторов. Изменения действуют для новых заявок.
              </p>
              {settings ? (
                <>
                  <label className="notification-option">
                    <input
                      type="checkbox"
                      checked={telegram}
                      onChange={(event) => setTelegram(event.target.checked)}
                    />{' '}
                    Telegram
                  </label>
                  <p>
                    {settings.telegramConfigured
                      ? 'Бот настроен.'
                      : 'Бот пока не настроен; заявки сохраняются в кабинете.'}
                  </p>
                  <label className="notification-option">
                    <input
                      type="checkbox"
                      checked={push}
                      onChange={(event) => setPush(event.target.checked)}
                    />{' '}
                    Уведомления браузера
                  </label>
                  <p>
                    {settings.pushConfigured
                      ? 'Сервис уведомлений настроен.'
                      : 'Сервис уведомлений ещё не настроен.'}
                  </p>
                  <button
                    className="button"
                    type="button"
                    disabled={busy}
                    onClick={() => void save()}
                  >
                    Сохранить каналы
                  </button>
                </>
              ) : (
                <p role="status">Загружаем настройки…</p>
              )}
            </>
          ) : null}
          {!supported ? (
            <p>
              Этот браузер или соединение не поддерживает уведомления. Откройте кабинет по
              защищённому адресу в поддерживаемом браузере.
            </p>
          ) : (
            <>
              <p>
                Устройство: {device ? 'подключено' : 'не подключено'}. Браузер и операционная
                система могут ограничивать показ уведомлений.
              </p>
              {typeof Notification !== 'undefined' && Notification.permission === 'denied' ? (
                <p>Разрешите уведомления в настройках браузера.</p>
              ) : null}
              <button
                className="button light"
                type="button"
                disabled={busy || (!device && !config?.configured)}
                onClick={() => void (device ? disableDevice() : enableDevice())}
              >
                {device ? 'Отключить это устройство' : 'Подключить это устройство'}
              </button>
            </>
          )}
          {busy ? <p role="status">Обновляем настройки уведомлений…</p> : null}
          {error ? (
            <p className="notice error" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? <p role="status">{notice}</p> : null}
        </div>
      </details>
    </section>
  );
}
