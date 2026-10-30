import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, csrf, message } from '../api/client';
import { useAuth } from './auth-context';
import { finishEditorExit, requestEditorExit } from './editor-exit';
import { uiText } from './ui-texts';

export function LogoutButton({ variant = 'default' }: { variant?: 'default' | 'header' }) {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const errorId = useId();
  async function logout() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await api.POST('/api/v1/auth/logout', { headers: await csrf() });
      if (result.error) throw result.error;
      finishEditorExit();
      navigate('/');
      await refresh();
    } catch (error) {
      setError(message(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <span className={`logout-control${variant === 'header' ? ' header-logout' : ''}`}>
      <button
        type="button"
        className={variant === 'header' ? 'button small header-logout-button' : 'button light'}
        disabled={busy}
        aria-busy={busy}
        aria-describedby={error ? errorId : undefined}
        onClick={() => requestEditorExit(() => void logout())}
      >
        <span className="logout-label">{busy ? uiText.loggingOut : uiText.logout}</span>
        {variant === 'header' ? (
          <span className="logout-size" aria-hidden="true">
            {uiText.loggingOut}
          </span>
        ) : null}
      </button>
      {error ? (
        <span id={errorId} role="alert" className="notice error">
          {error}
        </span>
      ) : null}
    </span>
  );
}
