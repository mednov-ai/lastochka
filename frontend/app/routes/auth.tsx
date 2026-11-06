import { data, redirect, useParams, type LoaderFunctionArgs } from 'react-router';
import AuthForm from '../ui/auth-form';
import { readLoginSession } from '../api/login-session.server';
import { firstWorkspace } from '../ui/access';

export async function loader({ request, params }: LoaderFunctionArgs) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
  if (params.action !== 'login') return data(null, { headers });
  const session = await readLoginSession(request);
  if (session?.state === 'FULL') throw redirect(firstWorkspace(session.account), { headers });
  if (session?.state === 'PASSWORD_CHANGE_REQUIRED')
    throw redirect('/account/change-password', { headers });
  if (session === null)
    throw new Response('Не удалось проверить вход. Обновите страницу.', { status: 503, headers });
  return data(null, { headers });
}
export function headers({
  loaderHeaders,
  errorHeaders,
}: {
  loaderHeaders: Headers;
  errorHeaders?: Headers;
}) {
  return errorHeaders?.has('Cache-Control') ? errorHeaders : loaderHeaders;
}
export function ErrorBoundary() {
  return (
    <main id="main" className="page">
      <h1>Не удалось проверить вход</h1>
      <p>Обновите страницу или попробуйте немного позже.</p>
    </main>
  );
}
export default function Auth() {
  const { action } = useParams();
  return (
    <main id="main" className="page">
      <AuthForm action={action} />
    </main>
  );
}
