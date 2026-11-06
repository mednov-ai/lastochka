import createClient from 'openapi-fetch';
import type { paths } from './schema';

export async function readLoginSession(request: Request) {
  const sessionCookie = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('LASTOCHKA_SESSION='));
  const client = createClient<paths>({
    baseUrl: process.env.BACKEND_INTERNAL_URL ?? 'http://127.0.0.1:8080/lastochka',
    headers: sessionCookie ? { Cookie: sessionCookie } : {},
  });
  try {
    const { data, error } = await client.GET('/api/v1/auth/me', {
      signal: AbortSignal.timeout(4000),
    });
    return error || !data ? null : data;
  } catch {
    return null;
  }
}
