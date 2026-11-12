import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from './auth-context';
import { useAuthDialog } from './auth-dialog';
import { uiText } from './ui-texts';
import { firstWorkspace } from './access';

export function FooterAdminEntry() {
  const { auth, status, refresh } = useAuth();
  const open = useAuthDialog();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const label =
    status === 'error'
      ? 'Повторить проверку входа'
      : status === 'ready' && auth?.state === 'FULL'
        ? uiText.adminCabinet
        : status === 'ready' && auth?.state === 'PASSWORD_CHANGE_REQUIRED'
          ? 'Сменить пароль'
          : uiText.adminEntry;
  return (
    <>
      <Link
        className="admin-entry"
        to={
          status === 'ready' && auth?.state === 'FULL'
            ? firstWorkspace(auth.account)
            : status === 'ready' && auth?.state === 'PASSWORD_CHANGE_REQUIRED'
              ? '/account/change-password'
              : '/auth/login'
        }
        aria-busy={busy}
        aria-label={label}
        onClick={(event) => {
          if (
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          if (busy) return;
          const trigger = event.currentTarget;
          setBusy(true);
          setError(false);
          void refresh()
            .then((current) => {
              if (!current) {
                setError(true);
                return;
              }
              if (current.state === 'FULL') navigate(firstWorkspace(current.account));
              else if (current.state === 'PASSWORD_CHANGE_REQUIRED')
                navigate('/account/change-password');
              else open(undefined, 'login', trigger);
            })
            .finally(() => setBusy(false));
        }}
      >
        <span>{label}</span>
        {error || status === 'error' ? (
          <span className="footer-auth-error" role="alert">
            Не удалось проверить вход. Нажмите ссылку ещё раз.
          </span>
        ) : null}
      </Link>
    </>
  );
}
