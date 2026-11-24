import { useCallback, useEffect, useRef, useState } from 'react';
import { api, csrf, message } from '../api/client';
import type { components } from '../api/schema';
import { RussianForm } from './russian-form';

type Settings = components['schemas']['VkSettingsView'];
type Chat = components['schemas']['VkChat'];
type Result = { data?: Settings; error?: unknown };

const vkErrors: Record<string, string> = {
  VK_BAD_KEY: 'Проверьте ключ сообщества и его доступ к сообщениям.',
  VK_KEY_STORAGE: 'Хранилище ключа недоступно. Обратитесь к оператору.',
  VK_CHAT_UNAVAILABLE: 'Проверьте, что сообщество добавлено в беседу.',
  VK_REJECTED:
    'ВКонтакте отклонило запрос. Проверьте права ключа и возможности бота в настройках сообщества.',
  VK_API_UNAVAILABLE: 'ВКонтакте временно недоступно. Повторите попытку позже.',
  VK_LIMITED: 'ВКонтакте ограничило частоту отправки. Повторите попытку позже.',
  VK_DESTINATION_CHANGED: 'Отправка в прежнюю беседу остановлена.',
};

export function vkError(code?: string | null) {
  return (code && vkErrors[code]) || 'Состояние отправки недоступно.';
}

export function VkEnquirySettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [chats, setChats] = useState<Chat[] | null>(null);
  const request = useRef(0);
  const form = useRef<HTMLFormElement>(null);
  const chatButton = useRef<HTMLButtonElement>(null);
  const testButton = useRef<HTMLButtonElement>(null);
  const enableButton = useRef<HTMLButtonElement>(null);
  const activeStatus = useRef<HTMLParagraphElement>(null);
  const nextFocus = useRef<'chat' | 'test' | 'enable' | 'active' | null>(null);

  useEffect(() => {
    if (busy || nextFocus.current === null) return;
    const target = {
      chat: chatButton,
      test: testButton,
      enable: enableButton,
      active: activeStatus,
    }[nextFocus.current];
    nextFocus.current = null;
    target.current?.focus();
  }, [busy, settings]);

  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    setLoadError('');
    try {
      const response = await api.GET('/api/v1/admin/enquiry-notification-settings/vk');
      if (response.error || !response.data) throw response.error;
      if (request.current === current) setSettings(response.data);
    } catch (failure) {
      if (request.current === current) setLoadError(message(failure, { announce: false }));
    } finally {
      if (request.current === current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      request.current++;
    };
  }, [load]);

  async function execute(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (failure) {
      setError(message(failure, { announce: false }));
      if (
        typeof failure === 'object' &&
        failure !== null &&
        'status' in failure &&
        failure.status === 409
      )
        await load();
    } finally {
      setBusy(false);
    }
  }

  function apply(response: Result) {
    if (response.error || !response.data) throw response.error;
    setSettings(response.data);
    return response.data;
  }

  async function saveKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (settings === null) return;
    const key = String(new FormData(event.currentTarget).get('vk-community-key') ?? '');
    await execute(async () => {
      const response = await api.PUT('/api/v1/admin/enquiry-notification-settings/vk/key', {
        headers: await csrf(),
        body: { version: settings.version, key },
      });
      apply(response);
      form.current?.reset();
      setChats(null);
      setEditing(false);
      nextFocus.current = 'chat';
    });
  }

  async function loadChats() {
    if (!settings) return;
    await execute(async () => {
      const response = await api.GET('/api/v1/admin/enquiry-notification-settings/vk/chats', {
        params: { query: { version: settings.version } },
      });
      if (response.error || !response.data) throw response.error;
      setChats(response.data);
    });
  }

  async function chooseChat(chatId: number) {
    if (!settings) return;
    await execute(async () => {
      apply(
        await api.PUT('/api/v1/admin/enquiry-notification-settings/vk/chat', {
          headers: await csrf(),
          body: { version: settings.version, chatId },
        }),
      );
      setChats(null);
      nextFocus.current = 'test';
    });
  }

  async function sendTest() {
    if (!settings) return;
    await execute(async () => {
      const result = apply(
        await api.POST('/api/v1/admin/enquiry-notification-settings/vk/test', {
          headers: await csrf(),
          body: { version: settings.version },
        }),
      );
      if (result.testStatus === 'VERIFIED') {
        setNotice('Проверьте, что тестовое сообщение пришло в беседу.');
        nextFocus.current = 'enable';
      }
    });
  }

  async function enable(enabled: boolean) {
    if (!settings) return;
    await execute(async () => {
      apply(
        await api.PUT('/api/v1/admin/enquiry-notification-settings/vk/enabled', {
          headers: await csrf(),
          body: { version: settings.version, enabled },
        }),
      );
      setNotice(enabled ? 'Уведомления ВКонтакте включены.' : 'Уведомления ВКонтакте выключены.');
      nextFocus.current = 'active';
    });
  }

  const showKey = editing || (settings && !settings.activeChat && !settings.draftHasKey);
  const configured = settings?.storageReady === true;
  return (
    <section className="form-card stack notification-channel" aria-labelledby="vk-settings-title">
      <h2 id="vk-settings-title">ВКонтакте</h2>
      {loading && <p role="status">Загружаем настройки ВКонтакте…</p>}
      {loadError && (
        <div className="stack">
          <p role="alert">{loadError}</p>
          <button type="button" className="button light" onClick={() => void load()}>
            Повторить загрузку
          </button>
        </div>
      )}
      {settings && !loadError && (
        <>
          <p ref={activeStatus} tabIndex={-1}>
            {settings.activeChat ? (
              <>
                <strong>Рабочая беседа:</strong> {settings.activeChat.title}.{' '}
                {settings.enabled ? 'Уведомления включены.' : 'Уведомления выключены.'}
              </>
            ) : (
              'Подключите закрытую беседу сотрудников.'
            )}
          </p>
          {showKey && configured ? (
            <RussianForm ref={form} onSubmit={saveKey}>
              <label>
                Ключ сообщества
                <input
                  type="password"
                  name="vk-community-key"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  maxLength={1024}
                />
              </label>
              <button className="button" disabled={busy}>
                Сохранить ключ
              </button>
              {editing && (
                <button type="button" className="button light" onClick={() => setEditing(false)}>
                  Отмена
                </button>
              )}
            </RussianForm>
          ) : configured ? (
            <button
              type="button"
              className="button light"
              disabled={busy}
              onClick={() => setEditing(true)}
            >
              Заменить ключ
            </button>
          ) : null}
          {configured && !showKey && (settings.draftHasKey || settings.activeChat) && (
            <>
              <button
                type="button"
                className="button light"
                disabled={busy}
                onClick={() => void loadChats()}
                ref={chatButton}
              >
                {settings.draftChat ? 'Выбрать другую беседу' : 'Выбрать беседу'}
              </button>
              {chats?.length === 0 && (
                <p>Пригласите сообщество в закрытую беседу и обновите список.</p>
              )}
              {chats && chats.length > 0 && (
                <RussianForm
                  onSubmit={(event) => {
                    event.preventDefault();
                    const chat = Number(new FormData(event.currentTarget).get('vk-chat'));
                    if (chat) void chooseChat(chat);
                  }}
                >
                  <label>
                    Беседа
                    <select name="vk-chat" required defaultValue="">
                      <option value="">Выберите беседу</option>
                      {chats.map((chat) => (
                        <option key={chat.id} value={chat.id}>
                          {chat.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="button" disabled={busy}>
                    Подтвердить беседу
                  </button>
                </RussianForm>
              )}
              {settings.draftChat && (
                <>
                  <p>
                    <strong>Выбранная беседа:</strong> {settings.draftChat.title}
                  </p>
                  {settings.testStatus === 'VERIFIED' ? (
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() => void enable(true)}
                      ref={enableButton}
                    >
                      {settings.enabled ? 'Применить подключение' : 'Включить уведомления'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() => void sendTest()}
                      ref={testButton}
                    >
                      Отправить тестовое сообщение
                    </button>
                  )}
                </>
              )}
            </>
          )}
          {settings.activeChat && (settings.enabled || (configured && !settings.draftHasKey)) && (
            <button
              type="button"
              className="button light"
              disabled={busy}
              onClick={() => void enable(!settings.enabled)}
            >
              {settings.enabled
                ? 'Выключить уведомления ВКонтакте'
                : 'Включить уведомления ВКонтакте'}
            </button>
          )}
          {(error || settings.error) && <p role="alert">{error || vkError(settings.error)}</p>}
          {busy && <p role="status">Обновляем настройки ВКонтакте…</p>}
          {notice && <p role="status">{notice}</p>}
        </>
      )}
    </section>
  );
}
