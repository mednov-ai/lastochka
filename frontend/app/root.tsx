import { ErrorToasts } from './ui/error-toasts';
import { SectionLink } from './ui/section-link';
import { useRef } from 'react';
import { useHeaderOffset } from './ui/header-offset';
import { headerLinks, MobileNavigation } from './ui/mobile-navigation';
import { uiText } from './ui/ui-texts';
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  Link,
  useRouteError,
  isRouteErrorResponse,
  useLoaderData,
  useLocation,
  type LoaderFunctionArgs,
} from 'react-router';
import { AuthProvider, useAuth } from './ui/auth-context';
import { AuthDialogProvider } from './ui/auth-dialog';
import { FooterAdminEntry } from './ui/footer-admin-entry';
import { BookingLink } from './ui/booking-link';
import { LogoutButton } from './ui/logout-button';
import './styles.css';
import createClient from 'openapi-fetch';
import type { paths } from './api/schema';
export async function loader({ request }: LoaderFunctionArgs) {
  if (new URL(request.url).pathname.includes('/booking/confirm')) return null;
  const client = createClient<paths>({
    baseUrl: process.env.BACKEND_INTERNAL_URL ?? 'http://127.0.0.1:8080/lastochka',
  });
  const { data, error } = await client
    .GET('/api/v1/public/landing', { signal: AbortSignal.timeout(4000) })
    .catch(() => ({ data: undefined, error: true }));
  if (error || !data) throw new Response('Контент временно недоступен', { status: 503 });
  return { ...data, publicUrl: process.env.PUBLIC_APP_URL ?? 'http://localhost:5173/lastochka/' };
}
export function meta({
  loaderData: data,
}: {
  loaderData: Awaited<ReturnType<typeof loader>> | undefined;
}) {
  if (!data) return [{ title: 'Ласточка' }];
  return [
    { title: data?.title ?? 'Ласточка' },
    { name: 'description', content: data?.description ?? '' },
    { property: 'og:title', content: data?.title ?? 'Ласточка' },
    { property: 'og:description', content: data?.description ?? '' },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: data?.publicUrl ?? '' },
    { tagName: 'link', rel: 'canonical', href: data?.publicUrl ?? '' },
  ];
}
export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <Meta />
        <Links />
      </head>
      <body>
        <a className="skip" href="#main">
          К содержимому
        </a>
        {children}
        <ErrorToasts />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
function Header({ phone }: { phone: string }) {
  const { auth, status } = useAuth();
  const { pathname } = useLocation();
  const inWorkspace = pathname.startsWith('/admin/') || pathname === '/account/security';
  const fullAdmin = status === 'ready' && auth?.state === 'FULL' && auth.account?.role === 'ADMIN';
  const header = useRef<HTMLElement>(null);
  useHeaderOffset(header);
  return (
    <header className="header" ref={header}>
      <Link to="/" className="brand" aria-label="Ласточка — на главную">
        <img
          src={`${import.meta.env.BASE_URL}images/logo-turquoise.svg`}
          width="600"
          height="195"
          alt="Ласточка — оздоровительная гимнастика"
        />
      </Link>
      <nav className="desktop-navigation" aria-label="Основная навигация">
        {headerLinks.map((link) => (
          <SectionLink key={link.to} to={link.to}>
            {link.text}
          </SectionLink>
        ))}
      </nav>
      <div className="header-actions">
        <a className="phone" href={'tel:' + phone.replace(/[^+\d]/g, '')}>
          {phone}
        </a>
        {fullAdmin && inWorkspace ? (
          <LogoutButton variant="header" />
        ) : auth?.state === 'FULL' ? (
          <Link className="button small" to="/admin/schedule" aria-label={uiText.adminCabinet}>
            <span className="header-cabinet-full">{uiText.adminCabinet}</span>
            <span className="header-cabinet-short" aria-hidden="true">
              {uiText.cabinet}
            </span>
            <span className="header-action-arrow" aria-hidden="true">
              ↗
            </span>
          </Link>
        ) : (
          <BookingLink className="button small">
            Записаться{' '}
            <span className="header-action-arrow" aria-hidden="true">
              ↗
            </span>
          </BookingLink>
        )}
      </div>
      <MobileNavigation header={header} />
    </header>
  );
}
export default function App() {
  const data = useLoaderData<typeof loader>();
  if (!data) return <Outlet />;
  return (
    <AuthProvider>
      <AuthDialogProvider>
        <Header phone={data.phone} />
        <Outlet />
        <footer>
          <div>
            <Link to="/" className="wordmark">
              Ласточка<span>расти в движении</span>
            </Link>
            <p>Студия детской оздоровительной гимнастики. Белгород.</p>
            <small>Физкультурно-оздоровительные занятия. Без диагностики и лечения.</small>
          </div>
          <div>
            <SectionLink to="/#schedule">Расписание</SectionLink>
            <FooterAdminEntry />
            <a href={'https://t.me/' + encodeURIComponent(data.telegram)}>Написать тренеру ↗</a>
          </div>
          <p className="copyright">© {new Date().getFullYear()} Ласточка</p>
        </footer>
      </AuthDialogProvider>
    </AuthProvider>
  );
}
export function ErrorBoundary() {
  const e = useRouteError();
  return (
    <main id="main" className="page">
      <p className="eyebrow">Ласточка</p>
      <h1>
        {isRouteErrorResponse(e) && e.status === 404
          ? 'Страница не найдена'
          : 'Пока не удалось загрузить страницу'}
      </h1>
      <p>Попробуйте обновить страницу немного позже.</p>
      <a className="button" href={import.meta.env.BASE_URL}>
        На главную ↗
      </a>
    </main>
  );
}
