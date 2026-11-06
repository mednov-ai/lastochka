import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, csrf, message } from '../api/client';
import { useAuth } from './auth-context';
import { publicFields } from './error-feedback';
import { PasswordField } from './password-field';
import { RussianForm } from './russian-form';
import { firstWorkspace } from './access';

export function PasswordChangeForm({ required = false }: { required?: boolean }) {
  const { auth, refresh } = useAuth();
  const navigate = useNavigate();
  const form = useRef<HTMLFormElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  useEffect(() => {
    form.current?.reset();
    setFields({});
    setError('');
    setNotice('');
    const element = form.current;
    return () => element?.reset();
  }, [auth?.account?.id]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    const element = event.currentTarget;
    const values = new FormData(element);
    setBusy(true);
    setError('');
    setFields({});
    setNotice('');
    try {
      const result = await api.POST('/api/v1/auth/change-password', {
        headers: await csrf(),
        body: {
          currentPassword: String(values.get('currentPassword')),
          newPassword: String(values.get('newPassword')),
          confirmPassword: String(values.get('confirmPassword')),
        },
      });
      if (result.error) throw result.error;
      element.reset();
      await refresh();
      window.dispatchEvent(new Event('lastochka:auth-changed'));
      if (required) navigate(firstWorkspace(result.data?.account), { replace: true });
      else setNotice('Пароль изменён. На других устройствах потребуется войти заново.');
    } catch (error) {
      setFields(publicFields(error));
      setError(message(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="form-card">
      <h2>{required ? 'Задайте постоянный пароль' : 'Сменить пароль'}</h2>
      <p>
        От 6 до 128 символов, хотя бы одна буква и одна цифра. Новый пароль должен отличаться от
        текущего.
      </p>
      <RussianForm ref={form} onSubmit={submit}>
        <PasswordField
          name="currentPassword"
          label={required ? 'Временный пароль' : 'Текущий пароль'}
          autoComplete="current-password"
          error={fields.currentPassword}
        />
        <PasswordField name="newPassword" label="Новый пароль" error={fields.newPassword} />
        <PasswordField
          name="confirmPassword"
          label="Повторите новый пароль"
          error={fields.confirmPassword}
        />
        {error ? (
          <p role="alert" className="notice error">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="notice">
            {notice}
          </p>
        ) : null}
        <button className="button" disabled={busy}>
          {busy ? 'Сохраняем…' : 'Сохранить пароль'}
        </button>
        {!required ? (
          <button
            type="button"
            className="button light"
            disabled={busy}
            onClick={() => {
              form.current?.reset();
              setError('');
              setFields({});
              setNotice('');
            }}
          >
            Очистить поля
          </button>
        ) : null}
      </RussianForm>
    </section>
  );
}
