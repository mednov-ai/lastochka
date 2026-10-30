import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from './auth-context';
import { useAuthDialog } from './auth-dialog';
import { uiText } from './ui-texts';

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
            ? '/admin/schedule'
            : status === 'ready' && auth?.state === 'PASSWORD_CHANGE_REQUIRED'
              ? '/account/change-password'
              : '/auth/login'
        }
        aria-busy={busy}
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
              if (current.state === 'FULL') navigate('/admin/schedule');
              else if (current.state === 'PASSWORD_CHANGE_REQUIRED')
                navigate('/account/change-password');
              else open(undefined, 'login', trigger);
            })
            .finally(() => setBusy(false));
        }}
      >
        {label}
      </Link>
      {error || status === 'error' ? (
        <span role="alert">Не удалось проверить вход. Нажмите ссылку ещё раз.</span>
      ) : null}
    </>
  );
}
