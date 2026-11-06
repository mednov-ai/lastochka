import { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from '../api/schema';
import { api, csrf, message } from '../api/client';
import { useAuth } from '../ui/auth-context';
import { AuthLink } from '../ui/auth-dialog';
import { publicFields } from '../ui/error-feedback';
import { PasswordField } from '../ui/password-field';
import { RussianForm } from '../ui/russian-form';
import { Workspace } from '../ui/workspace';

type User = components['schemas']['UserView'];
const permissionOptions = [
  ['SCHEDULE_VIEW', 'Просмотр расписания'],
  ['SCHEDULE_EDIT', 'Изменение расписания'],
  ['PAYMENT_VIEW', 'Просмотр оплат'],
  ['PAYMENT_EDIT', 'Изменение оплат'],
  ['ENQUIRIES_VIEW', 'Заявки'],
] as const;
export default function Users() {
  const { auth } = useAuth();
  const [data, setData] = useState<components['schemas']['UserPage'] | null>(null);
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<'create' | User | null>(null);
  const [accessMode, setAccessMode] = useState(false);
  const [role, setRole] = useState<'ADMIN' | 'STAFF'>('ADMIN');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const generation = useRef(0);
  const allowed = auth?.state === 'FULL' && auth.account?.role === 'ADMIN';
  const load = useCallback(async () => {
    const current = ++generation.current;
    if (!allowed) {
      setData(null);
      return;
    }
    const result = await api.GET('/api/v1/admin/users', { params: { query: { page, size: 25 } } });
    if (current !== generation.current) return;
    if (result.error) setError(message(result.error));
    else setData(result.data);
  }, [allowed, page, auth?.account?.id]);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  useEffect(() => {
    const element = form.current;
    return () => element?.reset();
  }, [mode]);
  useEffect(() => {
    setMode(null);
    setAccessMode(false);
    setRole('ADMIN');
    setPermissions([]);
    form.current?.reset();
    setFields({});
    setError('');
    setNotice('');
  }, [allowed, auth?.account?.id]);
  function close() {
    form.current?.reset();
    setMode(null);
    setAccessMode(false);
    setRole('ADMIN');
    setPermissions([]);
    setFields({});
    setError('');
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !mode) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setFields({});
    setNotice('');
    const values = new FormData(event.currentTarget);
    try {
      const headers = await csrf();
      const result =
        mode !== 'create' && accessMode
          ? await api.PUT('/api/v1/admin/users/{id}/access', {
              headers,
              params: { path: { id: mode.id } },
              body: {
                role,
                permissions: role === 'STAFF' ? permissions : [],
                revision: mode.accessRevision,
              },
            })
          : mode === 'create'
            ? await api.POST('/api/v1/admin/users', {
                headers,
                body: {
                  name: String(values.get('name')),
                  login: String(values.get('login')),
                  role,
                  permissions: role === 'STAFF' ? permissions : [],
                  temporaryPassword: String(values.get('temporaryPassword')),
                },
              })
            : await api.POST('/api/v1/admin/users/{id}/temporary-password', {
                headers,
                params: { path: { id: mode.id } },
                body: {
                  revision: mode.revision,
                  temporaryPassword: String(values.get('temporaryPassword')),
                },
              });
      if (result.error) throw result.error;
      close();
      setNotice(
        accessMode
          ? 'Права пользователя сохранены.'
          : 'Временный пароль назначен на 24 часа. Передайте его пользователю лично. При входе потребуется смена.',
      );
      await load();
    } catch (error) {
      setFields(publicFields(error));
      setError(message(error));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (auth?.state === 'FULL' && !allowed)
    return (
      <Workspace title="Раздел недоступен">
        <p>У вас нет доступа к управлению пользователями.</p>
      </Workspace>
    );
  return (
    <Workspace title="Пользователи">
      <noscript>
        Для управления пользователями включите выполнение сценариев в настройках браузера.
      </noscript>
      <p>Администратор имеет полный доступ. Сотруднику можно назначить отдельные права.</p>
      <div className="toolbar">
        <AuthLink className="button light" next="/admin/users">
          Подтвердить свой пароль заново
        </AuthLink>
        <button
          className="button"
          disabled={busy}
          onClick={() => {
            close();
            setMode('create');
            setNotice('');
          }}
        >
          Добавить пользователя
        </button>
      </div>
      {notice ? (
        <p role="status" className="notice">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="notice error">
          {error}
        </p>
      ) : null}
      {mode ? (
        <section
          className="form-card user-management-form"
          key={typeof mode === 'string' ? mode : mode.id}
        >
          <h2>
            {mode === 'create'
              ? role === 'ADMIN'
                ? 'Новый администратор'
                : 'Новый сотрудник'
              : accessMode
                ? `Права: ${mode.name} (${mode.login})`
                : `Временный пароль: ${mode.name} (${mode.login})`}
          </h2>
          <p>
            Для изменения подтвердите свой постоянный пароль не более 5 минут назад.
            {!accessMode
              ? ' Передайте временный пароль пользователю лично; повторно посмотреть его нельзя.'
              : ''}
          </p>
          <RussianForm ref={form} onSubmit={submit}>
            {mode === 'create' ? (
              <>
                <label>
                  Имя
                  <input
                    name="name"
                    required
                    maxLength={120}
                    autoComplete="off"
                    aria-invalid={!!fields.name}
                  />
                </label>
                {fields.name ? <p className="field-error">{fields.name}</p> : null}
                <label>
                  Логин
                  <input
                    name="login"
                    required
                    minLength={3}
                    maxLength={64}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-invalid={!!fields.login}
                  />
                </label>
                <p>От 3 до 64 символов: латинские буквы, цифры, точка, дефис или подчёркивание.</p>
                {fields.login ? <p className="field-error">{fields.login}</p> : null}
              </>
            ) : !accessMode ? (
              <label>
                <input type="checkbox" required name="confirmed" /> Назначить временный пароль
                пользователю {mode.login} и завершить его прежние сеансы
              </label>
            ) : null}
            {mode === 'create' || accessMode ? (
              <>
                <label>
                  Роль
                  <select
                    value={role}
                    onChange={(event) => setRole(event.target.value as 'ADMIN' | 'STAFF')}
                  >
                    <option value="ADMIN">Администратор</option>
                    <option value="STAFF">Сотрудник</option>
                  </select>
                </label>
                {role === 'STAFF' ? (
                  <fieldset>
                    <legend>Доступы</legend>
                    {permissionOptions.map(([key, label]) => (
                      <label className="notification-option" key={key}>
                        <input
                          type="checkbox"
                          checked={permissions.includes(key)}
                          onChange={(event) => {
                            setPermissions((current) => {
                              const selected = new Set(current);
                              if (event.target.checked) selected.add(key);
                              else selected.delete(key);
                              if (event.target.checked && key === 'SCHEDULE_EDIT')
                                selected.add('SCHEDULE_VIEW');
                              if (event.target.checked && key === 'PAYMENT_EDIT')
                                selected.add('PAYMENT_VIEW');
                              if (!event.target.checked && key === 'SCHEDULE_VIEW')
                                selected.delete('SCHEDULE_EDIT');
                              if (!event.target.checked && key === 'PAYMENT_VIEW')
                                selected.delete('PAYMENT_EDIT');
                              return [...selected];
                            });
                          }}
                        />{' '}
                        {label}
                      </label>
                    ))}
                  </fieldset>
                ) : (
                  <p>Администратор имеет полный доступ.</p>
                )}
              </>
            ) : null}
            {!accessMode ? (
              <>
                <PasswordField
                  name="temporaryPassword"
                  label="Временный пароль"
                  error={fields.temporaryPassword}
                />
                <p>От 6 до 128 символов, хотя бы одна буква и одна цифра. Действует 24 часа.</p>
              </>
            ) : null}
            <div className="toolbar">
              <button className="button" disabled={busy}>
                {busy
                  ? 'Сохраняем…'
                  : accessMode
                    ? 'Сохранить права'
                    : mode === 'create'
                      ? role === 'ADMIN'
                        ? 'Создать администратора'
                        : 'Создать сотрудника'
                      : 'Назначить временный пароль'}
              </button>
              <button type="button" className="button light" disabled={busy} onClick={close}>
                Отмена
              </button>
            </div>
          </RussianForm>
        </section>
      ) : null}
      <div className="users-list">
        {data?.items.map((user) => (
          <article className="user-row" key={user.id}>
            <div className="user-identity">
              <h2>{user.name}</h2>
              <p>
                Логин: {user.login} · {user.role === 'ADMIN' ? 'Администратор' : 'Сотрудник'}
              </p>
            </div>
            <p className="user-password-status">
              {user.mustChangePassword
                ? user.expiresAt && Date.parse(user.expiresAt) <= Date.now()
                  ? 'Временный пароль истёк'
                  : 'Пароль нужно сменить'
                : 'Постоянный пароль'}
            </p>
            <button
              className="button light"
              disabled={busy}
              onClick={() => {
                close();
                setMode(user);
                setAccessMode(true);
                setRole(user.role);
                setPermissions(user.permissions ?? []);
                setNotice('');
              }}
            >
              Изменить права
            </button>
            {user.id !== auth?.account?.id ? (
              <button
                className="button light"
                disabled={busy}
                onClick={() => {
                  close();
                  setMode(user);
                  setNotice('');
                }}
              >
                Назначить временный пароль
              </button>
            ) : (
              <p className="user-self">
                Ваш аккаунт. Свой пароль можно сменить в разделе безопасности.
              </p>
            )}
          </article>
        ))}
      </div>
      {data ? (
        <nav className="toolbar users-pagination" aria-label="Страницы пользователей">
          <button
            className="button light"
            disabled={busy || page === 0}
            onClick={() => {
              close();
              setPage((value) => value - 1);
            }}
          >
            Назад
          </button>
          <span>Страница {page + 1}</span>
          <button
            className="button light"
            disabled={busy || (page + 1) * data.size >= data.total}
            onClick={() => {
              close();
              setPage((value) => value + 1);
            }}
          >
            Далее
          </button>
        </nav>
      ) : (
        <p role="status">Загрузка пользователей…</p>
      )}
    </Workspace>
  );
}
