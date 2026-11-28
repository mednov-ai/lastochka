import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { api, csrf, message } from '../api/client';
import type { components } from '../api/schema';
import { RussianForm } from './russian-form';

type Settings = components['schemas']['VkSettingsView'];
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

function VkField({
  id,
  label,
  helpLabel,
  help,
  children,
}: {
  id: string;
  label: string;
  helpLabel: string;
  help: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const helpId = `${id}-help`;

  return (
    <div className="vk-field">
      <div className="vk-field-heading">
        <label htmlFor={id}>{label}</label>
        <button
          type="button"
          className="vk-field-help-button"
          aria-label={helpLabel}
          aria-expanded={expanded}
          aria-controls={helpId}
          onClick={() => setExpanded((previous) => !previous)}
        >
          <span aria-hidden="true">ⓘ</span>
        </button>
      </div>
      {children}
      <p id={helpId} className="vk-field-help-text" hidden={!expanded}>
        {help}
      </p>
    </div>
  );
}

function CallbackValue({ label, action, value }: { label: string; action: string; value: string }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<'copied' | 'manual' | null>(null);
  useEffect(() => {
    if (feedback !== 'copied') return;
    const timer = window.setTimeout(() => setFeedback(null), 2200);
    return () => window.clearTimeout(timer);
  }, [feedback]);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback('copied');
    } catch {
      input.current?.focus();
      input.current?.select();
      setFeedback('manual');
    }
  }
  return (
    <div className="vk-copy-field">
      <label htmlFor={id}>{label}</label>
      <div className="vk-copy-row">
        <input
          ref={input}
          id={id}
          name={id}
          readOnly
          value={value}
          spellCheck={false}
          autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          type="button"
          className="vk-copy-action"
          aria-label={action}
          title={feedback === 'copied' ? 'Скопировано' : action}
          onClick={() => void copy()}
        >
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {feedback === 'copied' ? (
              <path d="m5 12 4 4L19 6" />
            ) : (
              <>
                <rect x="8" y="8" width="12" height="13" rx="2" />
                <path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
              </>
            )}
          </svg>
        </button>
      </div>
      <span role="status" className={feedback === 'manual' ? 'vk-copy-hint' : 'visually-hidden'}>
        {feedback === 'copied'
          ? 'Скопировано'
          : feedback === 'manual'
            ? 'Значение выделено. Скопируйте его вручную.'
            : ''}
      </span>
    </div>
  );
}

export function VkEnquirySettings() {
  const guideId = useId();
  const keyId = useId();
  const codeId = useId();
  const callbackConfirmationId = useId();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [guideExpanded, setGuideExpanded] = useState(false);
  const [link, setLink] = useState<components['schemas']['VkLinkCode'] | null>(null);
  const [callback, setCallback] = useState<components['schemas']['VkCallbackSetup'] | null>(null);
  const request = useRef(0);
  const form = useRef<HTMLFormElement>(null);
  const chatButton = useRef<HTMLButtonElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const testButton = useRef<HTMLButtonElement>(null);
  const enableButton = useRef<HTMLButtonElement>(null);
  const activeStatus = useRef<HTMLParagraphElement>(null);
  const nextFocus = useRef<'chat' | 'code' | 'test' | 'enable' | 'active' | null>(null);

  useEffect(() => {
    if (busy || nextFocus.current === null) return;
    const target = {
      chat: chatButton,
      code: codeInput,
      test: testButton,
      enable: enableButton,
      active: activeStatus,
    }[nextFocus.current];
    nextFocus.current = null;
    target.current?.focus();
  }, [busy, settings, link]);

  const load = useCallback(async () => {
    const current = ++request.current;
    setLoading(true);
    setLoadError('');
    try {
      const response = await api.GET('/api/v1/admin/enquiry-notification-settings/vk');
      if (response.error || !response.data) throw response.error;
      if (request.current === current) {
        setSettings(response.data);
      }
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
    const updated = { ...response.data, linkAvailable: settings?.linkAvailable === true };
    setSettings(updated);
    return updated;
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
      setEditing(false);
      setCallback(null);
      setLink(null);
      nextFocus.current = 'chat';
      await load();
    });
  }

  async function prepareCallback(confirmation?: string) {
    if (!settings) return;
    await execute(async () => {
      const response = await api.POST(
        '/api/v1/admin/enquiry-notification-settings/vk/callback-setup',
        {
          headers: await csrf(),
          body: { version: settings.version, confirmation },
        },
      );
      if (response.error || !response.data) throw response.error;
      setCallback(response.data);
      if (response.data.version !== settings.version) {
        setLink(null);
        await load();
      }
      setNotice(confirmation ? 'Строка сохранена. Теперь нажмите «Подтвердить» во ВКонтакте.' : '');
    });
  }

  async function startLink() {
    if (!settings) return;
    await execute(async () => {
      const response = await api.POST('/api/v1/admin/enquiry-notification-settings/vk/link', {
        headers: await csrf(),
        body: { version: settings.version },
      });
      if (response.error || !response.data) throw response.error;
      setLink(response.data);
      nextFocus.current = 'code';
    });
  }

  async function refreshLink() {
    if (!settings) return;
    await execute(async () => {
      const response = await api.GET('/api/v1/admin/enquiry-notification-settings/vk');
      if (response.error || !response.data) throw response.error;
      setSettings(response.data);
      if (response.data.version !== settings.version) {
        setLink(null);
        nextFocus.current = response.data.draftChat ? 'test' : 'chat';
      } else if (link && Date.parse(link.expiresAt) <= Date.now()) {
        setLink(null);
        nextFocus.current = 'chat';
        setNotice('Срок действия кода истёк. Получите новый код.');
      } else {
        setNotice('Подтверждение беседы пока не получено.');
      }
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
    <section
      className="form-card stack notification-channel vk-channel"
      aria-labelledby="vk-settings-title"
    >
      <div className="vk-field-heading">
        <h2 id="vk-settings-title">ВКонтакте</h2>
        <button
          type="button"
          className="vk-field-help-button"
          aria-label="Как подключить беседу ВКонтакте"
          aria-expanded={guideExpanded}
          aria-controls={guideId}
          onClick={() => setGuideExpanded((previous) => !previous)}
        >
          <span aria-hidden="true">ⓘ</span>
        </button>
      </div>
      <ol id={guideId} className="vk-connection-guide" hidden={!guideExpanded}>
        <li>
          В настройках Callback API во ВКонтакте нажмите <strong>«Подтвердить»</strong>. Затем
          включите событие <strong>«Входящее сообщение»</strong>.
        </li>
        <li>Добавьте сообщество ВКонтакте в закрытую беседу, куда должны приходить заявки.</li>
        <li>
          В карточке ВКонтакте нажмите <strong>«Подключить беседу по коду»</strong> или{' '}
          <strong>«Сменить беседу»</strong>, если одна уже подключена.
        </li>
        <li>
          Скопируйте код. В беседе выберите сообщество через <kbd>@</kbd> и отправьте{' '}
          <strong>упоминание и код одним сообщением</strong>. Код действует 10 минут.
        </li>
        <li>
          В Ласточке нажмите <strong>«Проверить подключение»</strong>. Проверьте название беседы и
          нажмите <strong>«Отправить тестовое сообщение»</strong>.
        </li>
        <li>
          Убедитесь, что сообщение пришло в эту беседу. Затем нажмите{' '}
          <strong>«Включить уведомления»</strong> или <strong>«Применить подключение»</strong>.
        </li>
      </ol>
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
              <VkField
                id={keyId}
                label="Ключ сообщества"
                helpLabel="Где взять ключ сообщества"
                help="В управлении сообществом ВКонтакте откройте «Работа с API → Ключи доступа». Создайте ключ с правом «Сообщения сообщества» и вставьте его сюда."
              >
                <input
                  id={keyId}
                  type="password"
                  name="vk-community-key"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  maxLength={1024}
                />
              </VkField>
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
              <div className="stack vk-callback-settings">
                {!callback ? (
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() => void prepareCallback()}
                  >
                    Показать адрес и секретный ключ для ВКонтакте
                  </button>
                ) : (
                  <>
                    <h3>Сервер Callback API</h3>
                    <CallbackValue label="Адрес" action="Скопировать адрес" value={callback.url} />
                    <CallbackValue
                      label="Секретный ключ"
                      action="Скопировать секрет"
                      value={callback.secret}
                    />
                    <details
                      className="vk-callback-confirmation"
                      key={String(callback.confirmationSaved)}
                    >
                      <summary>
                        {callback.confirmationSaved
                          ? 'Настройка во ВКонтакте'
                          : 'Как подтвердить сервер во ВКонтакте'}
                      </summary>
                      <p>
                        В разделе «Работа с API → Callback API» вставьте адрес и секретный ключ в
                        поля сервера и нажмите «Сохранить».
                      </p>
                      {callback.confirmationSaved && (
                        <p>Строка подтверждения уже сохранена. Её можно заменить ниже.</p>
                      )}
                      <RussianForm
                        onSubmit={(event) => {
                          event.preventDefault();
                          const confirmation = String(
                            new FormData(event.currentTarget).get('confirmation') ?? '',
                          ).trim();
                          void prepareCallback(confirmation);
                        }}
                      >
                        <p id={`${callbackConfirmationId}-hint`}>
                          В настройках сервера ВКонтакте скопируйте значение после слов «Строка,
                          которую должен вернуть сервер».
                        </p>
                        <label htmlFor={callbackConfirmationId}>
                          Строка подтверждения ВКонтакте
                        </label>
                        <input
                          id={callbackConfirmationId}
                          name="confirmation"
                          autoComplete="off"
                          spellCheck={false}
                          required
                          aria-describedby={`${callbackConfirmationId}-hint`}
                          maxLength={128}
                        />
                        <button className="button light" disabled={busy}>
                          Сохранить строку подтверждения
                        </button>
                      </RussianForm>
                      <p>
                        Нажмите «Подтвердить» во ВКонтакте и включите «Входящее сообщение» на
                        вкладке «Типы событий».
                      </p>
                    </details>
                  </>
                )}
              </div>
              {settings.linkAvailable && !link && (
                <button
                  type="button"
                  className="button light"
                  disabled={busy}
                  onClick={() => void startLink()}
                  ref={chatButton}
                >
                  {settings.activeChat ? 'Сменить беседу' : 'Подключить беседу по коду'}
                </button>
              )}
              {!settings.linkAvailable && (
                <p>После подтверждения сервера вы сможете подключить беседу по коду.</p>
              )}
              {link && (
                <>
                  <VkField
                    id={codeId}
                    label="Код для беседы"
                    helpLabel="Как использовать код для беседы"
                    help="Добавьте сообщество в закрытую беседу. Отправьте туда код и упоминание сообщества через @ одним сообщением. Затем нажмите «Проверить подключение»."
                  >
                    <input
                      id={codeId}
                      ref={codeInput}
                      name="vk-chat-link-code"
                      autoComplete="off"
                      spellCheck={false}
                      readOnly
                      value={link.code}
                      aria-describedby={`${codeId}-expiry`}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <p className="vk-field-caption" id={`${codeId}-expiry`}>
                      Код действует 10 минут.
                    </p>
                  </VkField>
                  <button
                    type="button"
                    className="button light"
                    disabled={busy}
                    onClick={() => void refreshLink()}
                  >
                    Проверить подключение
                  </button>
                </>
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
