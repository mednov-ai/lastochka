import { Navigate, NavLink, useLocation } from 'react-router';
import { AuthLink } from './auth-dialog';
import { useAuth } from './auth-context';
export function Workspace({ children, title }: { children: React.ReactNode; title: string }) {
  const { auth } = useAuth();
  const location = useLocation();
  if (!auth)
    return (
      <main id="main" className="page">
        <noscript>
          Для работы в кабинете включите выполнение сценариев в настройках браузера.
        </noscript>
        <p role="status">Загрузка аккаунта…</p>
      </main>
    );
  if (auth.state === 'PASSWORD_CHANGE_REQUIRED')
    return <Navigate to="/account/change-password" replace />;
  if (auth.state !== 'FULL')
    return (
      <main id="main" className="page">
        <h1>Войдите в аккаунт</h1>
        <p>Войдите с логином и паролем администратора.</p>
        <AuthLink className="button" next={location.pathname + location.search}>
          Войти ↗
        </AuthLink>
      </main>
    );
  return (
    <main id="main" className="page">
      <p className="eyebrow">КАБИНЕТ · {auth.account?.name}</p>
      <p className="muted" style={{ marginBottom: 16 }}>
        Администратор
      </p>
      <nav className="workspace-navigation" aria-label="Навигация кабинета">
        <NavLink to="/admin/schedule">Сайт · Расписание</NavLink>
        <NavLink to="/admin/requests">Заявки</NavLink>
        <NavLink to="/admin/payments">Оплата</NavLink>
        <NavLink to="/admin/users">Пользователи</NavLink>
        <NavLink to="/account/security">Безопасность</NavLink>
      </nav>
      <h1>{title}</h1>
      {children}
    </main>
  );
}
export function Status({ value }: { value: string }) {
  const labels: Record<string, string> = {
    PENDING: 'Ожидает одобрения',
    CONFIRMED: 'Подтверждено',
    REJECTED: 'Отклонено',
    CANCELLED: 'Отменено',
    EXPIRED: 'Не рассмотрена вовремя',
    DRAFT: 'Черновик',
    OPEN: 'Приём открыт',
    CLOSED: 'Приём закрыт',
  };
  return <span className={`status ${value}`}>{labels[value] ?? 'Состояние недоступно'}</span>;
}
export function moscow(value: string) {
  return (
    new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Europe/Moscow',
    }).format(new Date(value)) + ' МСК'
  );
}
