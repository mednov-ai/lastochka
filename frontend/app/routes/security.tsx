import { PasswordChangeForm } from '../ui/password-change-form';
import { RussianForm } from '../ui/russian-form';
import { useEffect, useState, useCallback, useRef } from 'react';
import { api, csrf, message } from '../api/client';
import type { components } from '../api/schema';
import { useAuth } from '../ui/auth-context';
import { Workspace } from '../ui/workspace';
import { registerPasskey, authenticatePasskey } from '../ui/passkeys';
import { sensitiveActionError, useSensitiveConfirmation } from '../ui/sensitive-confirmation';
export default function Security() {
  const { auth, refresh } = useAuth();
  const { ensure, confirmation } = useSensitiveConfirmation();
  const [keys, setKeys] = useState<components['schemas']['CredentialView'][]>([]);
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const actionPending = useRef(false);
  const [notice, setNotice] = useState('');
  async function verifyKey() {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!(await ensure('проверить ключ доступа'))) return;
      await authenticatePasskey();
      await refresh();
      setNotice('Ключ доступа подтверждён.');
    } catch (error) {
      setError(message(error));
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    if (auth?.state !== 'FULL') {
      setKeys([]);
      setKeysLoaded(false);
      return;
    }
    const r = await api.GET('/api/v1/auth/webauthn/credentials');
    if (current !== generation.current) return;
    if (r.error) {
      setKeysLoaded(false);
      setError(message(r.error));
    } else {
      setError('');
      setKeys(r.data);
      setKeysLoaded(true);
    }
  }, [auth?.state, auth?.account?.id]);
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [load]);
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (actionPending.current) return;
    actionPending.current = true;
    const label = String(new FormData(e.currentTarget).get('label'));
    setBusy(true);
    setError('');
    let sent = false;
    try {
      if (!(await ensure('добавить ключ доступа'))) return;
      sent = true;
      await registerPasskey(label);
      await load();
    } catch (e) {
      setError(sensitiveActionError(e, sent));
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy(true);
    setError('');
    let sent = false;
    try {
      if (!(await ensure('отозвать ключ доступа'))) return;
      const headers = await csrf();
      sent = true;
      const r = await api.DELETE('/api/v1/auth/webauthn/credentials/{id}', {
        params: { path: { id } },
        headers,
      });
      if (r.error) throw r.error;
      await load();
    } catch (e) {
      setError(sensitiveActionError(e, sent));
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }
  async function rename(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    if (actionPending.current) return;
    actionPending.current = true;
    const label = String(new FormData(e.currentTarget).get('label'));
    setBusy(true);
    let sent = false;
    try {
      if (!(await ensure('переименовать ключ доступа'))) return;
      const headers = await csrf();
      sent = true;
      const r = await api.PATCH('/api/v1/auth/webauthn/credentials/{id}', {
        params: { path: { id } },
        headers,
        body: { label },
      });
      if (r.error) throw r.error;
      await load();
    } catch (e) {
      setError(sensitiveActionError(e, sent));
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  }
  return (
    <Workspace title="Безопасность аккаунта">
      {confirmation}
      <div className="security-layout">
        <PasswordChangeForm />
        <section className="security-keys form-card" aria-labelledby="security-keys-title">
          <h2 id="security-keys-title">Ключи доступа</h2>
          <p>
            Ключи доступа — по желанию. Для входа достаточно логина и пароля, даже если ключ
            недоступен. Для важных действий может потребоваться подтверждение пароля.
          </p>
          {busy ? <p role="status">Выполняем действие с ключом доступа…</p> : null}
          {notice ? (
            <p role="status" className="notice">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p data-page-error="true" className="notice error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="security-key-actions">
            {keys.length > 0 ? (
              <button className="button light" disabled={busy} onClick={() => void verifyKey()}>
                Проверить ключ доступа
              </button>
            ) : null}
          </div>
          <RussianForm onSubmit={add}>
            <label htmlFor="key-label">Название ключа</label>
            <input
              id="key-label"
              name="label"
              placeholder="Например, второй телефон"
              required
              maxLength={120}
            />
            <button className="button" disabled={busy}>
              Добавить ключ доступа ↗
            </button>
          </RussianForm>
          <div className="security-key-list">
            {keysLoaded && keys.length === 0 ? <p>Ключей доступа пока нет.</p> : null}
            {keys.map((k) => (
              <article className="security-key" key={k.id}>
                <RussianForm onSubmit={(e) => void rename(e, k.id)}>
                  <label className="muted">
                    Название <input name="label" defaultValue={k.label} required maxLength={120} />
                  </label>
                  <button className="button light" type="submit" disabled={busy}>
                    Сохранить название
                  </button>
                </RussianForm>
                <button
                  className="button light"
                  disabled={busy || keys.length <= 1}
                  onClick={() => void remove(k.id)}
                >
                  Отозвать
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </Workspace>
  );
}
