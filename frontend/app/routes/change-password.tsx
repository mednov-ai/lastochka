import { Navigate } from 'react-router';
import { useAuth } from '../ui/auth-context';
import { PasswordChangeForm } from '../ui/password-change-form';
import { firstWorkspace } from '../ui/access';
import { AuthLink } from '../ui/auth-dialog';
import { LogoutButton } from '../ui/logout-button';

export default function ChangePassword() {
  const { auth } = useAuth();
  if (auth?.state === 'FULL') return <Navigate to={firstWorkspace(auth.account)} replace />;
  return (
    <main id="main" className="page">
      <h1>Смена временного пароля</h1>
      <noscript>Для смены пароля включите выполнение сценариев в настройках браузера.</noscript>
      {!auth ? (
        <p role="status">Загрузка аккаунта…</p>
      ) : auth.state === 'PASSWORD_CHANGE_REQUIRED' ? (
        <>
          <p>До смены временного пароля функции кабинета недоступны.</p>
          <PasswordChangeForm required />
          <LogoutButton />
        </>
      ) : (
        <>
          <p>
            Войдите с действующим временным паролем. Если его срок истёк, попросите администратора
            назначить новый.
          </p>
          <AuthLink className="button" next="/account/change-password">
            Войти
          </AuthLink>
        </>
      )}
    </main>
  );
}
