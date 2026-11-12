import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { api, csrf, message } from '../api/client';
import { useAuth } from './auth-context';
import { normalizeError, UserFacingError } from './error-feedback';
import { PasswordField } from './password-field';
import { RussianForm } from './russian-form';

export function sensitiveActionError(error: unknown, sent: boolean): string {
  if (
    sent &&
    error &&
    typeof error === 'object' &&
    'requestId' in error &&
    error.requestId === 'network'
  )
    return 'Не удалось получить ответ. Результат действия неизвестен: проверьте текущее состояние перед повтором.';
  return message(error);
}

export function useSensitiveConfirmation() {
  const { auth } = useAuth();
  const location = useLocation();
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const pending = useRef<((value: boolean) => void) | null>(null);
  const generation = useRef(0);
  const running = useRef(false);
  const confirming = useRef(false);
  const confirmationRequest = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const headingId = useId();
  const descriptionId = useId();
  const actor = auth?.state === 'FULL' ? auth.account?.id : null;

  const finish = useCallback((value: boolean) => {
    if (!value) {
      generation.current++;
      confirmationRequest.current?.abort();
    }
    form.current?.reset();
    const resolve = pending.current;
    pending.current = null;
    setError('');
    setAction(null);
    resolve?.(value);
  }, []);

  useEffect(() => {
    generation.current++;
    finish(false);
    const invalidate = () => {
      generation.current++;
      finish(false);
    };
    window.addEventListener('lastochka:auth-changed', invalidate);
    window.addEventListener('lastochka:session-expired', invalidate);
    window.addEventListener('lastochka:auth-context-invalidated', invalidate);
    return () => {
      generation.current++;
      confirmationRequest.current?.abort();
      window.removeEventListener('lastochka:auth-changed', invalidate);
      window.removeEventListener('lastochka:session-expired', invalidate);
      window.removeEventListener('lastochka:auth-context-invalidated', invalidate);
      const resolve = pending.current;
      pending.current = null;
      resolve?.(false);
    };
  }, [actor, location.key, finish]);

  useEffect(() => {
    if (!action || !dialog.current) return;
    const element = dialog.current;
    const previous = trigger.current;
    element.showModal();
    element.querySelector<HTMLInputElement>('input[name="password"]')?.focus();
    return () => {
      if (element.open) element.close();
      requestAnimationFrame(() => previous?.isConnected && previous.focus({ preventScroll: true }));
    };
  }, [action]);

  const ensure = useCallback(
    async (description: string) => {
      if (!actor || running.current) return false;
      running.current = true;
      trigger.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const current = generation.current;
      try {
        const result = await api.GET('/api/v1/auth/password-confirmation');
        if (current !== generation.current) return false;
        if (result.error || !result.data)
          throw new UserFacingError(
            'Не удалось проверить подтверждение пароля. Обновите страницу или обратитесь к администратору.',
          );
        if (result.data.fresh) return true;
        return await new Promise<boolean>((resolve) => {
          pending.current = resolve;
          setAction(description);
        });
      } finally {
        running.current = false;
      }
    },
    [actor],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirming.current || !pending.current) return;
    confirming.current = true;
    setBusy(true);
    setError('');
    const current = generation.current;
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    const controller = new AbortController();
    confirmationRequest.current = controller;
    try {
      const result = await api.POST('/api/v1/auth/password-confirmation', {
        headers: await csrf(),
        body: { password },
        signal: controller.signal,
      });
      if (current !== generation.current || !pending.current) return;
      if (result.error) {
        const code = (result.error as { code?: string }).code;
        setError(
          code === 'INVALID_CREDENTIALS'
            ? 'Неверный пароль. Попробуйте ещё раз.'
            : normalizeError(result.error),
        );
      } else if (result.data?.fresh) finish(true);
      else setError('Не удалось подтвердить пароль. Попробуйте ещё раз.');
    } catch {
      if (current === generation.current)
        setError('Не удалось подтвердить пароль. Проверьте соединение и повторите попытку.');
    } finally {
      confirming.current = false;
      confirmationRequest.current = null;
      setBusy(false);
    }
  }

  const confirmation = (
    <dialog
      ref={dialog}
      className="auth-dialog"
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        finish(false);
      }}
    >
      {action ? (
        <div className="form-card">
          <h2 id={headingId}>Подтвердите пароль</h2>
          <p id={descriptionId}>
            Чтобы {action}, подтвердите свой пароль. Это защищает важные настройки, если кабинет
            открыт без вас.
          </p>
          <RussianForm ref={form} onSubmit={submit}>
            <PasswordField name="password" label="Текущий пароль" autoComplete="current-password" />
            {error ? (
              <p role="alert" className="notice error">
                {error}
              </p>
            ) : null}
            <div className="toolbar">
              <button className="button" disabled={busy}>
                {busy ? 'Проверяем…' : 'Подтвердить и продолжить'}
              </button>
              <button type="button" className="button light" onClick={() => finish(false)}>
                Отмена
              </button>
            </div>
          </RussianForm>
        </div>
      ) : null}
    </dialog>
  );
  return { ensure, confirmation };
}
