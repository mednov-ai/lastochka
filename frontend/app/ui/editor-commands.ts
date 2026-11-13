import type { components } from '../api/schema';
import { appPath, currentApiPath } from '../api/base-path';
// Only calendar commands are recorded. Authentication, contacts and cookies never enter storage.
type Entry = {
  key: string;
  actor: string;
  url: string;
  method: string;
  body: string;
  resource: string;
  started: number;
  status: 'pending' | 'unknown';
};
const storageKey = 'lastochka-calendar-commands-v1';
let actor: string | null = null;
let entries: Entry[] = [];
let revision = 0;
const subscribers = new Set<() => void>();
const running = new Map<string, Promise<Response>>();
export const editorRevision = () => revision;
export const subscribeEditorCommands = (f: () => void) => {
  subscribers.add(f);
  return () => {
    subscribers.delete(f);
  };
};
export const editorCommands = () => entries;
function notify(settled = false) {
  revision++;
  if (typeof window !== 'undefined') {
    try {
      if (entries.length) sessionStorage.setItem(storageKey, JSON.stringify(entries));
      else sessionStorage.removeItem(storageKey);
    } catch {
      /* Storage may be unavailable; the current tab still keeps its command. */
    }
    if (settled) window.dispatchEvent(new Event('lastochka:calendar-settled'));
  }
  for (const f of subscribers) f();
}
function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<Entry>;
  return (
    typeof e.actor === 'string' &&
    typeof e.key === 'string' &&
    typeof e.url === 'string' &&
    /^\/(?:lastochka\/)?api\/v1\/admin\/(sessions|session-series|schedule-groups|age-directions|permanent-schedule)(\/|$)/.test(
      e.url,
    ) &&
    ['POST', 'PUT', 'DELETE'].includes(e.method ?? '') &&
    typeof e.body === 'string' &&
    typeof e.resource === 'string' &&
    typeof e.started === 'number'
  );
}
export function setEditorActor(next: string | null) {
  if (next === actor) return;
  actor = next;
  entries = [];
  if (typeof window !== 'undefined' && next) {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
      if (Array.isArray(saved))
        entries = saved
          .filter(isEntry)
          .filter((e) => e.actor === next)
          .map((e) => ({
            ...e,
            url: currentApiPath(e.url),
            resource: currentApiPath(e.resource),
            status: 'unknown',
          }));
    } catch {
      /* Invalid or inaccessible storage never triggers a command. */
    }
  }
  notify();
}
const pendingResponse = () =>
  new Response(
    JSON.stringify({
      status: 409,
      code: 'EDITOR_PENDING',
      detail: 'Сначала уточните результат предыдущего действия в сообщении над календарём.',
      fieldErrors: {},
    }),
    { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
  );

export async function calendarFetch(request: Request, send: (r: Request) => Promise<Response>) {
  const url = new URL(request.url),
    key = request.headers.get('Idempotency-Key');
  const match = url.pathname.match(
    /^(.*\/api\/v1\/admin\/(?:sessions|session-series|schedule-groups|age-directions|permanent-schedule))(?:\/([a-f\d-]{36}))?(?:\/|$)/i,
  );
  if (
    !actor ||
    !key ||
    !match ||
    !['POST', 'PUT', 'DELETE'].includes(request.method) ||
    url.pathname.endsWith('/preview')
  )
    return send(request);
  const resource = match[1] + (match[2] ? '/' + match[2] : '');
  const body = await request.clone().text();
  const previous = entries.find((e) => e.resource === resource);
  if (previous && (previous.key !== key || previous.body !== body || previous.url !== url.pathname))
    return pendingResponse();
  if (previous && Date.now() - previous.started >= 86400000) return pendingResponse();
  const runKey = actor + ':' + key;
  if (running.has(runKey) && previous?.status === 'pending')
    return (await running.get(runKey)!).clone();
  const entry: Entry = previous ?? {
    key,
    resource,
    body,
    actor,
    url: url.pathname,
    method: request.method,
    started: Date.now(),
    status: 'pending',
  };
  if (!previous) entries = [...entries, entry];
  entry.status = 'pending';
  notify();
  const timer = setTimeout(() => {
    if (entries.includes(entry)) {
      entry.status = 'unknown';
      notify();
    }
  }, 10000);
  const operation: Promise<Response> = Promise.resolve().then(async () => {
    try {
      let response = await send(request);
      if (response.ok) {
        try {
          const value: unknown = await response.clone().json();
          if (!value || typeof value !== 'object') throw new Error('Invalid command response');
        } catch {
          response = new Response(
            JSON.stringify({
              status: 503,
              code: 'SERVICE_UNAVAILABLE',
              detail: 'Ответ сервера не удалось прочитать. Уточните результат прежнего действия.',
              fieldErrors: {},
            }),
            { status: 503, headers: { 'Content-Type': 'application/problem+json' } },
          );
        }
      }
      if (entries.includes(entry)) {
        if (response.status >= 500) {
          entry.status = 'unknown';
          notify();
        } else {
          entries = entries.filter((e) => e !== entry);
          notify(true);
        }
      }
      return response;
    } catch (error) {
      if (entries.includes(entry)) {
        entry.status = 'unknown';
        notify();
      }
      throw error;
    } finally {
      clearTimeout(timer);
      if (running.get(runKey) === operation) running.delete(runKey);
    }
  });
  running.set(runKey, operation);
  return (await operation).clone();
}
export async function repeatEditorCommand(key: string) {
  const entry = entries.find((e) => e.key === key && e.actor === actor);
  if (!entry) return;
  if (Date.now() - entry.started >= 86400000)
    throw new Error(
      'Срок безопасного повтора истёк. Сверьте расписание и историю перед новой записью.',
    );
  const tokenResponse = await fetch(appPath('/api/v1/auth/csrf'), { credentials: 'same-origin' });
  if (!tokenResponse.ok) throw new Error('Войдите заново для проверки результата.');
  const csrf = (await tokenResponse.json()) as components['schemas']['CsrfResponse'];
  const response = await calendarFetch(
    new Request(new URL(entry.url, window.location.origin), {
      method: entry.method,
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        [csrf.headerName]: csrf.token,
        'Idempotency-Key': entry.key,
      },
      body: entry.body,
    }),
    fetch,
  );
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.detail ?? 'Не удалось уточнить результат. Повторите прежнее действие.');
  }
}
export function acknowledgeExpiredCommand(key: string) {
  entries = entries.filter(
    (e) => !(e.key === key && e.actor === actor && Date.now() - e.started >= 86400000),
  );
  notify();
}
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (entries.length) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  window.addEventListener('lastochka:auth-changed', () => setEditorActor(null));
}
