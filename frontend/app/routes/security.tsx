import { PasswordChangeForm } from '../ui/password-change-form';
import { RussianForm } from '../ui/russian-form';
import { useEffect, useState, useCallback, useRef } from 'react';
import { api, csrf, message } from '../api/client';
import type { components } from '../api/schema';
import { useAuth } from '../ui/auth-context';
import { Workspace } from '../ui/workspace';
import { registerPasskey, authenticatePasskey } from '../ui/passkeys';
import { AuthLink } from '../ui/auth-dialog';
import { AlfaSettings } from '../ui/alfa-settings';
export default function Security() {
  const { auth, refresh } = useAuth();
  const [keys, setKeys] = useState<components['schemas']['CredentialView'][]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  async function verifyKey() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await authenticatePasskey();
      await refresh();
      setNotice('Ключ доступа подтверждён.');
    } catch (error) {
      setError(message(error));
    } finally {
      setBusy(false);
    }
  }
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    if (auth?.state !== 'FULL') {
      setKeys([]);
      return;
    }
    const r = await api.GET('/api/v1/auth/webauthn/credentials');
    if (current !== generation.current) return;
    if (r.error) setError(message(r.error));
    else {
      setError('');
      setKeys(r.data);
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
    const label = String(new FormData(e.currentTarget).get('label'));
    setBusy(true);
    setError('');
    try {
      await registerPasskey(label);
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setError('');
    try {
      const r = await api.DELETE('/api/v1/auth/webauthn/credentials/{id}', {
        params: { path: { id } },
        headers: await csrf(),
      });
      if (r.error) throw r.error;
      await load();
    } catch (e) {
      setError(message(e));
    }
  }
  async function rename(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault();
    const label = String(new FormData(e.currentTarget).get('label'));
    try {
      const r = await api.PATCH('/api/v1/auth/webauthn/credentials/{id}', {
        params: { path: { id } },
        headers: await csrf(),
        body: { label },
      });
      if (r.error) throw r.error;
      await load();
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <Workspace title="Безопасность аккаунта">
      <div className="security-layout">
        <PasswordChangeForm />
        <section className="security-keys form-card" aria-labelledby="security-keys-title">
          <h2 id="security-keys-title">Ключи доступа</h2>
          <p>
            Ключи доступа — по желанию. Для входа достаточно логина и пароля, даже если ключ
            недоступен. Для управления ключами подтвердите пароль не более 5 минут назад.
          </p>
          {notice ? (
            <p role="status" className="notice">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p data-page-error="true" className="notice error">
              {error}
            </p>
          ) : null}
          <div className="security-key-actions">
            <AuthLink className="button light" next="/account/security">
              Подтвердить пароль заново
            </AuthLink>
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
            {keys.map((k) => (
              <article className="security-key" key={k.id}>
                <RussianForm onSubmit={(e) => void rename(e, k.id)}>
                  <label className="muted">
                    Название <input name="label" defaultValue={k.label} required maxLength={120} />
                  </label>
                  <button className="button light" type="submit">
                    Сохранить название
                  </button>
                </RussianForm>
                <button
                  className="button light"
                  disabled={keys.length <= 1}
                  onClick={() => void remove(k.id)}
                >
                  Отозвать
                </button>
              </article>
            ))}
          </div>
        </section>
      </div>
      {auth?.state === 'FULL' && auth.account?.role === 'ADMIN' ? <AlfaSettings /> : null}
    </Workspace>
  );
}
