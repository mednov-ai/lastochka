import { useEffect, useRef, useState, useId } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router';
import { RussianForm } from './russian-form';
import { firstWorkspace } from './access';
import { api, csrf, message } from '../api/client';
import { useAuth } from './auth-context';
import { publicFields } from './error-feedback';
import { PasswordField } from './password-field';
export default function AuthForm({
  action = 'login',
  next,
  modal = false,
  onSuccess,
}: {
  action?: string;
  next?: string;
  modal?: boolean;
  onSuccess?: () => void;
}) {
  const fieldId = useId();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const first = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (modal) first.current?.focus();
  }, [modal]);
  if (action !== 'login')
    return (
      <section className="form-card">
        <h1>Теперь можно оставить заявку без аккаунта</h1>
        <p>Регистрация и ссылки из писем больше не используются.</p>
        <Link className="button" to="/enquiry">
          Оставить заявку
        </Link>
      </section>
    );
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const element = e.currentTarget;
    const values = new FormData(element);
    setBusy(true);
    setError('');
    setFields({});
    try {
      const r = await api.POST('/api/v1/auth/password-stage', {
        headers: await csrf(),
        body: { login: String(values.get('login')), password: String(values.get('password')) },
      });
      if (r.error) throw r.error;
      element.reset();
      await refresh();
      window.dispatchEvent(new Event('lastochka:auth-changed'));
      onSuccess?.();
      const target = next ?? search.get('next');
      if (r.data?.state === 'PASSWORD_CHANGE_REQUIRED') {
        navigate('/account/change-password', { replace: true });
        return;
      }
      navigate(
        target &&
          /^\/(?:admin\/(schedule|requests|payments|users)|account\/(security|change-password))$/.test(
            target,
          )
          ? target
          : firstWorkspace(r.data?.account),
      );
    } catch (error) {
      setFields(publicFields(error));
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  const Heading = modal ? 'h2' : 'h1';
  return (
    <div className="form-card">
      <Heading id={modal ? 'auth-dialog-title' : undefined}>Вход администратора</Heading>
      <p>Доступ только для заранее заданных администраторов.</p>
      <RussianForm onSubmit={submit}>
        <label>
          Логин
          <input
            ref={first}
            name="login"
            autoComplete="username"
            required
            maxLength={64}
            aria-invalid={!!fields.login}
            aria-describedby={fieldId + '-login-error'}
          />
        </label>
        <p id={fieldId + '-login-error'} className="field-error">
          {fields.login}
        </p>
        <PasswordField
          name="password"
          label="Пароль"
          autoComplete="current-password"
          error={fields.password}
        />
        {error ? (
          <p className="notice error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="button" disabled={busy}>
          {busy ? 'Входим…' : 'Войти'}
        </button>
      </RussianForm>
      <p className="muted">Если забыли пароль, обратитесь к оператору сайта.</p>
    </div>
  );
}
