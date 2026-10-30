import { data } from 'react-router';
import createClient from 'openapi-fetch';
import type { paths, components } from './schema';
import { addDays, dayStart, dateKey, monday } from '../ui/calendar-time';
import { phoneFromForm } from '../ui/phone';
import { uiText } from '../ui/ui-texts';
type Session = components['schemas']['SessionView'];
type Values = {
  parentName: string;
  phone: string;
  childName: string;
  childAge: string;
  comment: string;
};
const empty: Values = { parentName: '', phone: '', childName: '', childAge: '', comment: '' };
function client(request: Request) {
  return createClient<paths>({
    baseUrl: process.env.BACKEND_INTERNAL_URL ?? 'http://127.0.0.1:8080/lastochka',
    headers: {
      Cookie: request.headers.get('Cookie') ?? '',
      'X-Forwarded-For': request.headers.get('X-Forwarded-For') ?? '127.0.0.1',
    },
  });
}
function period(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dayStart(value).valueOf())
    ? monday(value)
    : monday(dateKey(new Date()));
}
function pageNumber(value: string) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}
async function options(c: ReturnType<typeof client>, from: string, page: number) {
  const r = await c.GET('/api/v1/sessions', {
    params: {
      query: {
        from: dayStart(from).toISOString(),
        to: dayStart(addDays(from, 7)).toISOString(),
        page,
        size: 10,
        selectable: true,
      },
    },
  });
  return {
    options: r.data ?? null,
    listError: r.error ? 'Не удалось загрузить расписание. Повторите выбор периода.' : '',
  };
}
async function selection(c: ReturnType<typeof client>, id: string) {
  if (!id) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await c.GET('/api/v1/sessions/{id}', { params: { path: { id } } });
  return r.data ?? null;
}
function available(s: Session | null) {
  return !!s && s.status === 'OPEN' && new Date(s.startsAt).valueOf() > Date.now();
}
export async function enquiryLoader(request: Request) {
  const c = client(request);
  const url = new URL(request.url);
  const id = url.searchParams.get('session') ?? '';
  const from = period('');
  const [csrf, s, list] = await Promise.all([
    c.GET('/api/v1/auth/csrf'),
    selection(c, id),
    options(c, from, 0),
  ]);
  if (!csrf.data) throw new Response('Форма временно недоступна', { status: 503 });
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  const cookie = csrf.response.headers.get('set-cookie');
  if (cookie) headers.append('Set-Cookie', cookie);
  return data(
    {
      csrf: csrf.data,
      key: crypto.randomUUID(),
      values: empty,
      selected: s,
      selectedId: id,
      selectedVersion: s?.version ?? null,
      selectionUnavailable: !!id && !available(s),
      selectionChanged: false,
      picking: false,
      from,
      page: 0,
      ...list,
      error: '',
      fields: {} as Record<string, string>,
      receipt: null as components['schemas']['EnquiryReceipt'] | null,
    },
    { headers },
  );
}
export async function enquiryAction(request: Request) {
  const form = await request.formData();
  const str = (name: string) => String(form.get(name) ?? '');
  const c = client(request);
  const intent = str('intent') || 'submit';
  const values: Values = {
    parentName: str('parentName').slice(0, 101),
    phone: phoneFromForm(form) ?? str('phoneNational').slice(0, 40),
    childName: str('childName').slice(0, 101),
    childAge: str('childAge').slice(0, 6),
    comment: str('comment').slice(0, 1001),
  };
  let id = str('desiredSessionId');
  let version = str('desiredSessionVersion') === '' ? null : Number(str('desiredSessionVersion'));
  let from = period(str('from'));
  let page = pageNumber(str('page'));
  let key = str('commandKey');
  let picking = str('picking') === 'true';
  let error = '';
  let fields: Record<string, string> = {};
  let receipt: components['schemas']['EnquiryReceipt'] | null = null;
  let status = 200;
  const csrf = await c.GET('/api/v1/auth/csrf');
  const expectedOrigin = new URL(process.env.PUBLIC_APP_URL ?? request.url).origin;
  if (
    !csrf.data ||
    !str('_csrf') ||
    csrf.data.token !== str('_csrf') ||
    request.headers.get('Origin') !== expectedOrigin
  )
    throw new Response('Не удалось подтвердить отправку формы. Обновите страницу.', {
      status: 403,
      headers: { 'Cache-Control': 'no-store' },
    });
  let selected = await selection(c, id);
  if (intent === 'change') {
    picking = true;
  } else if (intent === 'clear') {
    id = '';
    version = null;
    selected = null;
    picking = false;
    key = crypto.randomUUID();
  } else if (
    intent === 'period' ||
    intent === 'prev-week' ||
    intent === 'next-week' ||
    intent === 'prev-page' ||
    intent === 'next-page' ||
    intent === 'this-week' ||
    intent === 'following-week'
  ) {
    if (intent === 'prev-week') from = addDays(from, -7);
    if (intent === 'next-week') from = addDays(from, 7);
    if (intent === 'this-week') from = period('');
    if (intent === 'following-week') from = addDays(period(''), 7);
    page = intent === 'prev-page' ? Math.max(0, page - 1) : intent === 'next-page' ? page + 1 : 0;
    picking = true;
  } else if (intent.startsWith('choose|')) {
    const [, chosen, revision] = intent.split('|');
    const candidate = await selection(c, chosen);
    if (available(candidate) && candidate!.version === Number(revision)) {
      id = chosen;
      version = candidate!.version;
      selected = candidate;
      picking = false;
      key = crypto.randomUUID();
    } else {
      error = 'Это занятие изменилось или недоступно. Выберите актуальный вариант.';
      picking = true;
      status = 409;
    }
  } else if (intent === 'accept-selection') {
    if (available(selected)) {
      version = selected!.version;
      key = crypto.randomUUID();
      picking = false;
    } else {
      error = 'Это занятие недоступно. Выберите другое время или общую заявку.';
      picking = true;
      status = 409;
    }
  } else if (intent === 'submit') {
    const phone = phoneFromForm(form);
    if (phone === null) {
      error = uiText.phoneIncomplete;
      fields.phone = uiText.phoneIncomplete;
      status = 400;
    } else if (id && (!available(selected) || selected!.version !== version)) {
      error = 'Выбранное занятие изменилось или недоступно. Проверьте условия и подтвердите выбор.';
      status = 409;
      picking = true;
      key = crypto.randomUUID();
    } else {
      try {
        const r = await c.POST('/api/v1/enquiries', {
          params: { header: { 'Idempotency-Key': key } },
          headers: { 'X-CSRF-TOKEN': str('_csrf'), Origin: expectedOrigin },
          body: {
            parentName: values.parentName,
            phone,
            childName: values.childName || null,
            childAge: values.childAge.trim() ? Number(values.childAge) : null,
            comment: values.comment,
            desiredSessionId: id || null,
            desiredSessionVersion: version,
          },
        });
        if (r.error) {
          error = r.error.detail ?? 'Не удалось отправить заявку.';
          fields = r.error.fieldErrors ?? {};
          status = r.response.status;
          if (status === 409) {
            picking = true;
            key = crypto.randomUUID();
            selected = await selection(c, id);
          }
        } else receipt = r.data;
      } catch {
        error = 'Сервис временно недоступен. Повторите отправку с теми же данными.';
        status = 503;
      }
    }
  } else throw new Response('Действие формы недоступно', { status: 400 });
  const list = await options(c, from, page);
  return data(
    {
      csrf: csrf.data,
      key,
      values,
      selected,
      selectedId: id,
      selectedVersion: version,
      selectionUnavailable: !!id && !available(selected),
      selectionChanged: !!id && !!selected && version !== selected.version,
      picking,
      from,
      page,
      ...list,
      error,
      fields,
      receipt,
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}
