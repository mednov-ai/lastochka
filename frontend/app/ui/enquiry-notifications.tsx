import { useEffect, useState } from 'react';
import { api, csrf, message } from '../api/client';
import type { components } from '../api/schema';
import { VkEnquirySettings } from './vk-enquiry-settings';

type Settings = components['schemas']['NotificationSettings'];
type Config = components['schemas']['PushConfigurationView'];

function decodeKey(value: string): Uint8Array<ArrayBuffer> {
  const text = value.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(text + '='.repeat((4 - (text.length % 4)) % 4));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function PushEnquirySettings({
  accountId,
  canManage = true,
}: {
  accountId: string;
  canManage?: boolean;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [push, setPush] = useState(false);
  const [device, setDevice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadRevision, setLoadRevision] = useState(0);
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
      setLoading(true);
      setLoadError('');
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
        if (live) setLoadError(message(value, { announce: false }));
      } finally {
        if (live) setLoading(false);
      }
    }
    void load();
    return () => {
      live = false;
    };
  }, [accountId, storageKey, supported, canManage, loadRevision]);

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await api.PUT('/api/v1/admin/enquiry-notification-settings', {
        headers: await csrf(),
        body: { ...settings, telegramEnabled: false, browserPushEnabled: push },
      });
      if (response.error) throw response.error;
      setSettings(response.data);
      setNotice('Общая настройка браузерных уведомлений сохранена.');
    } catch (value) {
      setError(message(value, { announce: false }));
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
            : message(value, { announce: false }),
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
            : message(value, { announce: false }),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="form-card stack notification-channel" aria-labelledby="push-settings-title">
      <h2 id="push-settings-title">Уведомления браузера</h2>
      {loading && <p role="status">Загружаем настройки браузера…</p>}
      {loadError && (
        <div className="stack">
          <p role="alert">{loadError}</p>
          <button
            type="button"
            className="button light"
            onClick={() => setLoadRevision((value) => value + 1)}
          >
            Повторить загрузку
          </button>
        </div>
      )}
      {!loading && !loadError && (
        <>
          {canManage && settings && (
            <fieldset className="stack notification-device">
              <legend>Для студии</legend>
              <label className="notification-option">
                <input
                  name="browser-push"
                  type="checkbox"
                  checked={push}
                  onChange={(event) => setPush(event.target.checked)}
                />
                Отправлять браузерные уведомления о новых заявках
              </label>
              {!settings.pushConfigured && <p>Сервис уведомлений ещё не настроен.</p>}
              <button
                className="button light"
                type="button"
                disabled={busy}
                onClick={() => void save()}
              >
                Сохранить общую настройку
              </button>
            </fieldset>
          )}
          <fieldset className="stack notification-device">
            <legend>На этом устройстве</legend>
            {!supported ? (
              <p>
                Этот браузер или соединение не поддерживает уведомления. Откройте кабинет по
                защищённому адресу в поддерживаемом браузере.
              </p>
            ) : (
              <>
                <p>{device ? 'Устройство подключено.' : 'Устройство не подключено.'}</p>
                {Notification.permission === 'denied' && (
                  <p>Разрешите уведомления в настройках браузера.</p>
                )}
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
          </fieldset>
        </>
      )}
      {busy && <p role="status">Обновляем настройки браузера…</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

export function EnquiryNotifications({
  accountId,
  canManage = true,
}: {
  accountId: string;
  canManage?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby="enquiry-notifications-title">
      <details
        className="notification-settings"
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary id="enquiry-notifications-title">Уведомления о заявках</summary>
        {open && (
          <div className="notification-channels" key={accountId}>
            {canManage && <VkEnquirySettings />}
            <PushEnquirySettings accountId={accountId} canManage={canManage} />
          </div>
        )}
      </details>
    </section>
  );
}
