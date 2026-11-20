import { data } from 'react-router';
import createClient from 'openapi-fetch';
import type { paths, components } from './schema';
import { readWeeklyChoice, weeklyChoice } from '../ui/weekly-interval';
import { phoneFromForm } from '../ui/phone';
import { uiText } from '../ui/ui-texts';
import type { EnquiryOption, EnquiryValues } from '../ui/enquiry-choice';
type PosterDirection = components['schemas']['AgeDirectionView'];

type Receipt = components['schemas']['EnquiryReceipt'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const empty: EnquiryValues = {
  parentName: '',
  phone: '',
  ageDirectionId: '',
  participantName: '',
  desiredChoice: '',
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
type Client = ReturnType<typeof client>;

async function loadDirections(c: Client): Promise<PosterDirection[] | null> {
  try {
    const r = await c.GET('/api/v1/public/age-directions');
    if (r.error || !r.data) return null;
    return r.data.items.filter((d) => d.active);
  } catch {
    return null;
  }
}

async function weeklyOptions(c: Client) {
  try {
    const result = await c.GET('/api/v1/public/schedule/weekly');
    if (!result.data) return { directions: await loadDirections(c), options: [], listError: true };
    return {
      directions: result.data.directions,
      options: result.data.intervals.map((interval) => ({
        choice: weeklyChoice(interval.reference),
        directionId: interval.directionId,
        interval,
      })),
      listError: false,
    };
  } catch {
    return { directions: await loadDirections(c), options: [], listError: true };
  }
}

// An already open V31 form may be retrying a POST whose response was lost.
// Only the backend can distinguish that receipt from a new, expired choice.
function datedRetry(choice: string) {
  const [kind, id, value, revision, ...extra] = choice.split('|');
  if (!id || !uuid.test(id) || extra.length) return;
  if (
    kind === 'session' &&
    revision === undefined &&
    /^\d+$/.test(value) &&
    Number.isSafeInteger(+value)
  )
    return { desiredSessionId: id, desiredSessionVersion: +value };
  if (
    kind === 'rule' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    /^[1-9]\d*$/.test(revision) &&
    Number.isSafeInteger(+revision)
  )
    return {
      calculatedSession: {
        referenceVersion: 1,
        seriesId: id,
        originalDate: value,
        seriesVersion: +revision,
      },
    };
}

function view(
  base: {
    csrf: components['schemas']['CsrfResponse'];
    key: string;
    values: EnquiryValues;
    directions: PosterDirection[] | null;
    options: EnquiryOption[];
    listError: boolean;
  },
  extra: Partial<{
    open: boolean;
    notice: string;
    error: string;
    fields: Record<string, string>;
    receipt: Receipt | null;
    uncertain: boolean;
  }> = {},
) {
  return {
    ...base,
    open: false,
    notice: '',
    error: '',
    fields: {} as Record<string, string>,
    receipt: null as Receipt | null,
    uncertain: false,
    ...extra,
  };
}

export async function enquiryLoader(request: Request) {
  const c = client(request);
  const url = new URL(request.url);
  const [csrf, list] = await Promise.all([c.GET('/api/v1/auth/csrf'), weeklyOptions(c)]);
  if (!csrf.data) throw new Response('Форма временно недоступна', { status: 503 });
  const weekly = url.searchParams.get('weekly');
  const { directions } = list;
  const values = { ...empty };
  let notice = '';
  const wanted = url.searchParams.get('direction') ?? '';
  if (directions?.some((d) => d.id === wanted)) values.ageDirectionId = wanted;
  const pre = ['session', 'series', 'date', 'revision'].some((name) => url.searchParams.has(name));
  if (weekly !== null) {
    const chosen = list.options.find((o) => o.choice === weekly);
    if (chosen?.directionId && !pre && (!wanted || wanted === chosen.directionId)) {
      values.desiredChoice = chosen.choice;
      values.ageDirectionId = chosen.directionId;
    } else notice = uiText.enquiryChoiceUnavailable;
  } else if (pre)
    notice =
      'Ссылка вела на занятие по дате. Выберите время в постоянном расписании или попросите подобрать его.';
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  const cookie = csrf.response.headers.get('set-cookie');
  if (cookie) headers.append('Set-Cookie', cookie);
  return data(
    view(
      { csrf: csrf.data, key: crypto.randomUUID(), values, ...list },
      { open: !!values.desiredChoice || !!notice, notice },
    ),
    { headers },
  );
}

export async function enquiryAction(request: Request) {
  const form = await request.formData();
  const str = (name: string) => String(form.get(name) ?? '');
  const c = client(request);
  const values: EnquiryValues = {
    parentName: str('parentName').slice(0, 101),
    phone: phoneFromForm(form) ?? str('phoneNational').slice(0, 40),
    ageDirectionId: str('ageDirectionId').slice(0, 36),
    participantName: str('participantName').slice(0, 101),
    desiredChoice: str('desiredChoice').slice(0, 120),
    comment: str('comment').slice(0, 1001),
  };
  let key = str('commandKey');
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
  const weekly = readWeeklyChoice(values.desiredChoice);
  const list = await weeklyOptions(c);
  const { directions } = list;
  const base = { csrf: csrf.data, key, values, ...list };
  const reply = (status: number, extra: Parameters<typeof view>[1]) =>
    data(view({ ...base, key }, extra), { status, headers: { 'Cache-Control': 'no-store' } });

  const fields: Record<string, string> = {};
  const phone = phoneFromForm(form);
  if (phone === null) fields.phone = uiText.phoneIncomplete;
  if (!directions) return reply(503, { error: uiText.enquiryDirectionsUnavailable, fields });
  if (!directions.some((d) => d.id === values.ageDirectionId))
    fields.ageDirectionId = uiText.enquiryDirectionRequired;
  if (Object.keys(fields).length)
    return reply(400, { error: Object.values(fields)[0], fields, open: !!values.desiredChoice });

  const legacy = datedRetry(values.desiredChoice);
  if (values.desiredChoice && !weekly && !legacy) {
    values.desiredChoice = '';
    return reply(409, { error: uiText.enquiryChoiceUnavailable, open: true });
  }
  try {
    const r = await c.POST('/api/v1/enquiries', {
      params: { header: { 'Idempotency-Key': key } },
      headers: { 'X-CSRF-TOKEN': str('_csrf'), Origin: expectedOrigin },
      body: {
        parentName: values.parentName,
        phone: phone!,
        contractVersion: 3,
        ageDirectionId: values.ageDirectionId,
        participantName: values.participantName.trim() || null,
        comment: values.comment,
        ...legacy,
        ...(weekly ? { weeklyPreference: weekly } : {}),
      },
    });
    if (r.error) {
      const status = r.response.status;
      if (status === 409) {
        values.desiredChoice = '';
        key = crypto.randomUUID();
      }
      return reply(status, {
        error:
          status === 409 && legacy
            ? uiText.enquiryChoiceUnavailable
            : status === 409 && weekly
              ? uiText.enquiryChoiceChanged
              : (r.error.detail ?? uiText.enquirySendFailed),
        fields: r.error.fieldErrors ?? {},
        uncertain: status >= 500,
        open: status === 409,
      });
    }
    return reply(200, { receipt: r.data });
  } catch {
    return reply(503, { error: uiText.enquiryServiceUnavailable, uncertain: true });
  }
}
