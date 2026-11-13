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
import { firstWorkspace } from './ui/access';
import './styles.css';
import createClient from 'openapi-fetch';
import type { paths } from './api/schema';
export async function loader({ request }: LoaderFunctionArgs) {
  const pathname = new URL(request.url).pathname;
  if (pathname.includes('/booking/confirm') || pathname.endsWith('/payments/test/return'))
    return null;
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
  const title =
    data.title === 'Ласточка — детская оздоровительная гимнастика в Белгороде'
      ? 'Ласточка — оздоровительная гимнастика в Белгороде'
      : data.title;
  const description =
    data.description ===
    'Занятия для детей 5–14 лет: движение, координация и здоровые привычки. Мини-группы и индивидуальные занятия с Паргевом Арутюняном.'
      ? 'Оздоровительная гимнастика в Белгороде для детей от 3 лет, подростков и взрослых. Групповые и индивидуальные занятия.'
      : data.description;
  return [
    { title: title ?? 'Ласточка' },
    { name: 'description', content: description ?? '' },
    { property: 'og:title', content: title ?? 'Ласточка' },
    { property: 'og:description', content: description ?? '' },
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
        <link
          rel="icon"
          type="image/svg+xml"
          href={`${import.meta.env.BASE_URL}images/logo-turquoise.svg`}
        />
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
  const fullAdmin = status === 'ready' && auth?.state === 'FULL';
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
          <Link
            className="button small"
            to={firstWorkspace(auth.account)}
            aria-label={uiText.adminCabinet}
          >
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
        <div className="site-shell">
          <Header phone={data.phone} />
          <Outlet />
          <section className="site-details" aria-label="О студии">
            <p>Студия оздоровительной гимнастики. Белгород.</p>
            <p>Физкультурно-оздоровительные занятия. Без диагностики и лечения.</p>
            <p>© {new Date().getFullYear()} Ласточка</p>
          </section>
          <footer className="site-footer">
            <nav className="site-footer-links" aria-label="Ссылки сайта">
              <Link to="/" className="wordmark">
                Ласточка<span>расти в движении</span>
              </Link>
              <SectionLink to="/#schedule">Расписание</SectionLink>
              <FooterAdminEntry />
              <a href="https://vk.ru/lastochkagym">Сообщество ВКонтакте</a>
              <Link className="footer-legal-link" to="/legal/privacy">
                Политика обработки персональных данных
              </Link>
              <Link className="footer-legal-link" to="/legal/terms">
                Пользовательское соглашение
              </Link>
            </nav>
          </footer>
        </div>
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
