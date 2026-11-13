import { data } from 'react-router';
import createClient from 'openapi-fetch';
import type { paths, components } from './schema';
import { addDays, dayStart, dateKey, monday } from '../ui/calendar-time';
import { phoneFromForm } from '../ui/phone';
import { uiText } from '../ui/ui-texts';
import {
  entryFrom,
  entriesFromPage,
  validReference,
  type RuleReference,
  type ScheduleEntry,
} from '../ui/schedule-occurrence';
type Values = {
  parentName: string;
  phone: string;
  childName: string;
  childAge: string;
  participantType: 'CHILD' | 'SELF';
  participantAge: string;
  comment: string;
};
const empty: Values = {
  parentName: '',
  phone: '',
  childName: '',
  childAge: '',
  participantType: 'CHILD',
  participantAge: '',
  comment: '',
};
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
  try {
    const r = await c.GET('/api/v1/public/schedule', {
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
    if (r.error) throw r.error;
    return { options: { ...r.data, items: entriesFromPage(r.data, page, 10) }, listError: '' };
  } catch {
    return {
      options: null,
      listError: 'Не удалось загрузить расписание. Повторите выбор периода.',
    };
  }
}
async function selection(c: ReturnType<typeof client>, id: string) {
  if (!id) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await c.GET('/api/v1/sessions/{id}', { params: { path: { id } } });
  if (r.error && r.response.status !== 404) throw r.error;
  return r.data ? entryFrom({ kind: 'SESSION', session: r.data }) : null;
}
function available(s: ScheduleEntry | null) {
  return !!s && s.status === 'OPEN' && new Date(s.startsAt).valueOf() > Date.now();
}
function reference(seriesId: string, originalDate: string, revision: string): RuleReference | null {
  const value: RuleReference = {
    referenceVersion: 1,
    seriesId,
    originalDate,
    seriesVersion: Number(revision),
  };
  return validReference(value) ? value : null;
}
async function referenceSelection(
  c: ReturnType<typeof client>,
  ref: RuleReference,
): Promise<ScheduleEntry | null> {
  const from = dayStart(ref.originalDate).toISOString();
  const to = dayStart(addDays(ref.originalDate, 1)).toISOString();
  let page = 0,
    total: number | null = null;
  const seen = new Set<string>();
  const matches: ScheduleEntry[] = [];
  do {
    const r = await c.GET('/api/v1/public/schedule', {
      params: { query: { from, to, page, size: 100, selectable: true } },
    });
    if (r.error || !r.data) throw new Error('Schedule unavailable');
    if (total !== null && total !== r.data.total) throw new Error('Schedule changed during lookup');
    total = r.data.total;
    if (total > 5000) throw new Error('Schedule too dense');
    for (const item of entriesFromPage(r.data, page, 100)) {
      const key = item.rule ? `${item.rule.seriesId}:${item.rule.originalDate}` : item.key;
      if (seen.has(key)) throw new Error('Duplicate schedule item');
      seen.add(key);
      if (item.rule?.seriesId === ref.seriesId && item.rule.originalDate === ref.originalDate)
        matches.push(item);
    }
    page++;
  } while (page * 100 < total);
  if (matches.length > 1) throw new Error('Duplicate schedule reference');
  return matches[0] ?? null;
}
async function chosen(c: ReturnType<typeof client>, id: string, ref: RuleReference | null) {
  try {
    return {
      selected: ref ? await referenceSelection(c, ref) : await selection(c, id),
      lookupError: false,
    };
  } catch {
    return { selected: null, lookupError: true };
  }
}
export async function enquiryLoader(request: Request) {
  const c = client(request);
  const url = new URL(request.url);
  const id = url.searchParams.get('session') ?? '';
  const series = url.searchParams.get('series') ?? '';
  const date = url.searchParams.get('date') ?? '';
  const revision = url.searchParams.get('revision') ?? '';
  const ref = reference(
    series,
    date,
    revision,
  );
  const hasReference = !!(series || date || revision);
  const invalidReference = (hasReference && !ref) || (hasReference && !!id);
  const from = period(ref?.originalDate ?? '');
  const [csrf, found, list] = await Promise.all([
    c.GET('/api/v1/auth/csrf'),
    chosen(c, id, ref),
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
      selected: found.selected,
      selectedId: id,
      selectedVersion: ref ? null : (found.selected?.sessionVersion ?? null),
      selectedRef: ref,
      invalidReference,
      uncertain: false,
      selectionUnavailable: invalidReference || ((!!id || !!ref) && !available(found.selected)),
      selectionChanged:
        !!ref && !!found.selected?.rule && ref.seriesVersion !== found.selected.rule.seriesVersion,
      picking: false,
      from,
      page: 0,
      ...list,
      error: found.lookupError ? 'Не удалось проверить занятие. Повторите выбор.' : '',
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
    participantType: str('participantType') === 'SELF' ? 'SELF' : 'CHILD',
    participantAge: str('participantAge').slice(0, 6),
    comment: str('comment').slice(0, 1001),
  };
  let id = str('desiredSessionId');
  let version = str('desiredSessionVersion') === '' ? null : Number(str('desiredSessionVersion'));
  let ref = reference(
    str('desiredSeriesId'),
    str('desiredOriginalDate'),
    str('desiredSeriesVersion'),
  );
  let invalidReference =
    str('invalidReference') === 'true' ||
    (!!(str('desiredSeriesId') || str('desiredOriginalDate') || str('desiredSeriesVersion')) && !ref) ||
    (!!id && !!ref) ||
    (!!ref && version !== null);
  let from = period(str('from'));
  let page = pageNumber(str('page'));
  let key = str('commandKey');
  let picking = str('picking') === 'true';
  let uncertain = intent === 'submit' && str('uncertain') === 'true';
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
  let found = await chosen(c, id, ref);
  let selected = found.selected;
  if (found.lookupError) {
    error = 'Не удалось проверить занятие. Повторите выбор.';
    status = 503;
  }
  if (intent === 'participant-child' || intent === 'participant-self') {
    values.participantType = intent === 'participant-self' ? 'SELF' : 'CHILD';
    key = crypto.randomUUID();
  } else if (intent === 'change') {
    picking = true;
  } else if (intent === 'clear') {
    id = '';
    version = null;
    ref = null;
    invalidReference = false;
    selected = null;
    picking = false;
    key = crypto.randomUUID();
    error = '';
    status = 200;
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
    const [, chosenId, revision] = intent.split('|');
    const candidate = await chosen(c, chosenId, null);
    if (available(candidate.selected) && candidate.selected!.sessionVersion === Number(revision)) {
      id = chosenId;
      version = candidate.selected!.sessionVersion;
      ref = null;
      invalidReference = false;
      selected = candidate.selected;
      picking = false;
      key = crypto.randomUUID();
    } else {
      error = candidate.lookupError ? 'Не удалось проверить занятие. Повторите выбор.' :
        'Это занятие изменилось или недоступно. Выберите актуальный вариант.';
      picking = true;
      status = candidate.lookupError ? 503 : 409;
    }
  } else if (intent.startsWith('choose-rule|')) {
    const [, seriesId, date, revision] = intent.split('|');
    const candidateRef = reference(seriesId, date, revision);
    const candidate = candidateRef
      ? await chosen(c, '', candidateRef)
      : { selected: null, lookupError: false };
    if (
      candidateRef &&
      available(candidate.selected) &&
      candidate.selected?.rule?.seriesVersion === candidateRef.seriesVersion
    ) {
      id = '';
      version = null;
      ref = candidateRef;
      invalidReference = false;
      selected = candidate.selected;
      picking = false;
      key = crypto.randomUUID();
    } else {
      error = candidate.lookupError ? 'Не удалось проверить занятие. Повторите выбор.' :
        'Это занятие изменилось или недоступно. Выберите актуальный вариант.';
      picking = true;
      status = candidate.lookupError ? 503 : 409;
    }
  } else if (intent === 'accept-selection') {
    if (available(selected)) {
      if (ref && selected!.rule) ref = selected!.rule;
      else version = selected!.sessionVersion;
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
    } else if (
      invalidReference ||
      (!uncertain && found.lookupError) ||
      (!uncertain && (id || ref) &&
        (!available(selected) ||
          (ref
            ? selected!.rule?.seriesVersion !== ref.seriesVersion
            : selected!.sessionVersion !== version)))
    ) {
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
            contractVersion: 2,
            participantType: values.participantType,
            participantAge:
              values.participantType === 'SELF' && values.participantAge.trim()
                ? Number(values.participantAge)
                : null,
            childName: values.participantType === 'CHILD' ? values.childName || null : null,
            childAge:
              values.participantType === 'CHILD' && values.childAge.trim()
                ? Number(values.childAge)
                : null,
            comment: values.comment,
            desiredSessionId: id || null,
            desiredSessionVersion: version,
            calculatedSession: ref,
          },
        });
        if (r.error) {
          error = r.error.detail ?? 'Не удалось отправить заявку.';
          fields = r.error.fieldErrors ?? {};
          status = r.response.status;
          uncertain = status >= 500;
          if (status === 409) {
            picking = true;
            key = crypto.randomUUID();
            found = await chosen(c, id, ref);
            selected = found.selected;
          }
        } else receipt = r.data;
      } catch {
        error = 'Сервис временно недоступен. Повторите отправку с теми же данными.';
        status = 503;
        uncertain = true;
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
      selectedRef: ref,
      invalidReference,
      uncertain,
      selectionUnavailable: invalidReference || ((!!id || !!ref) && !available(selected)),
      selectionChanged:
        !!selected &&
        (ref
          ? selected.rule?.seriesVersion !== ref.seriesVersion
          : !!id && version !== selected.sessionVersion),
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
