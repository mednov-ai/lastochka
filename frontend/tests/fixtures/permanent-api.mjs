// Isolated in-memory fixture: no database, credentials, notifications or external network.
import http from 'node:http';
import { readFileSync } from 'node:fs';

// Use the project's original presentation-backed layout as synthetic fixture data.
const landingSql = readFileSync(new URL('../../../backend/app/src/main/resources/db/migration/V3__landing_content.sql', import.meta.url), 'utf8');
const landing = JSON.parse(landingSql.match(/VALUES \(1,1,1,'(.*)'::jsonb\)/s)[1]);

let mode = 'virtual';
let submissions = [];
let receiptByKey = new Map();
const seriesId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const originalDate = '2080-01-01';
const startsAt = '2080-01-01T14:00:00Z';
const endsAt = '2080-01-01T15:00:00Z';
const origin = () => ({ referenceVersion: 1, seriesId, originalDate, seriesVersion: mode === 'stale' ? 2 : 1 });
const calculated = () => ({ seriesId, originalDate, seriesVersion: origin().seriesVersion, title: '8–9 лет', startsAt, endsAt, capacity: 8, ageFrom: 8, ageTo: 9, ageOpenEnded: false });
const session = () => ({ id: sessionId, title: '8–9 лет', format: 'GROUP', startsAt, endsAt, capacity: 8, ageFrom: 8, ageTo: 9, ageOpenEnded: false, status: 'OPEN', version: 1, zone: 'Europe/Moscow' });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  let status = 200, body;
  if (url.pathname === '/__fixture/state') body = { mode, submissions, seriesId, originalDate };
  else if (url.pathname === '/__fixture/reset') { mode = url.searchParams.get('mode') || 'virtual'; submissions = []; receiptByKey = new Map(); body = { mode }; }
  else if (url.pathname === '/__fixture/mode') { mode = url.searchParams.get('mode') || 'virtual'; body = { mode }; }
  else if (url.pathname.endsWith('/api/v1/public/landing')) body = landing;
  else if (url.pathname.endsWith('/api/v1/public/age-directions')) {
    if (mode === 'age-error') { status = 503; body = { code: 'SERVICE_UNAVAILABLE' }; }
    else body = { items: ['3–5 лет', '6–7 лет', mode === 'age-updated' ? '8–10 лет' : '8–9 лет', '10–13 лет', '14+ лет'].map((title, index) => ({ id: `b8c0a000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, title, description: 'Тестовое описание' })) };
  }
  else if (url.pathname.endsWith('/api/v1/auth/csrf')) body = { headerName: 'X-CSRF-TOKEN', parameterName: '_csrf', token: 'fixture' };
  else if (url.pathname.endsWith('/api/v1/auth/me')) body = { state: 'ANONYMOUS' };
  else if (url.pathname.endsWith('/api/v1/public/schedule')) {
    const page = Number(url.searchParams.get('page') || 0), size = Number(url.searchParams.get('size') || 20);
    const inRange = startsAt >= url.searchParams.get('from') && startsAt < url.searchParams.get('to');
    const entry = mode === 'realized' ? { kind: 'SESSION', session: session(), origin: origin() } : { kind: 'CALCULATED', calculated: calculated() };
    const all = inRange && mode === 'many' ? Array.from({ length: 25 }, (_, index) => {
      const start = new Date(new Date(startsAt).valueOf() + index * 600000);
      const id = `cccccccc-cccc-4ccc-8ccc-${String(index + 1).padStart(12, '0')}`;
      return { kind: 'SESSION', session: { ...session(), id, title: `Группа ${index + 1}`,
        startsAt: start.toISOString(), endsAt: new Date(start.valueOf() + 3600000).toISOString() } };
    }) : inRange && mode !== 'cancelled' ? [entry] : [];
    body = { items: all.slice(page * size, (page + 1) * size), page, size, total: all.length, containsCalculated: all.some((x) => x.kind === 'CALCULATED') };
    if (mode === 'incomplete' && inRange) body.total = 2;
    if (mode === 'error') { status = 503; body = { status, code: 'SERVICE_UNAVAILABLE', detail: 'Расписание временно недоступно.', fieldErrors: {}, requestId: 'fixture' }; }
  } else if (url.pathname.endsWith('/api/v1/sessions/00000000-0000-4000-8000-000000000001')) {
    const start = new Date(Date.now() + 4 * 86400000);
    body = { ...session(), id: '00000000-0000-4000-8000-000000000001', title: 'Проверочное занятие', ageFrom: 14, ageTo: null, ageOpenEnded: true,
      startsAt: start.toISOString(), endsAt: new Date(start.valueOf() + 3600000).toISOString() };
  } else if (url.pathname.endsWith(`/api/v1/sessions/${sessionId}`)) body = session();
  else if (url.pathname.endsWith('/api/v1/enquiries') && req.method === 'POST') {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const input = JSON.parse(raw), key = req.headers['idempotency-key'];
    if (receiptByKey.has(key)) {
      const previous = receiptByKey.get(key);
      if (previous.raw === raw) body = previous.receipt;
      else { status = 409; body = { status, code: 'IDEMPOTENCY_CONFLICT', detail: 'Данные заявки изменились.', fieldErrors: {}, requestId: 'fixture' }; }
    } else if ((mode === 'stale' || mode === 'cancelled') && input.calculatedSession) {
      status = 409; body = { status, code: 'VERSION_CONFLICT', detail: 'Условия занятия изменились.', fieldErrors: {}, requestId: 'fixture' };
    } else {
      submissions.push(input);
      const receipt = { number: submissions.length, createdAt: new Date().toISOString() };
      receiptByKey.set(key, { raw, receipt });
      if (mode === 'lost-response') { status = 503; body = { status, code: 'SERVICE_UNAVAILABLE', detail: 'Повторите отправку с теми же данными.', fieldErrors: {}, requestId: 'fixture' }; }
      else body = receipt;
    }
  } else { status = 404; body = { status, code: 'NOT_FOUND', detail: 'Не найдено.', fieldErrors: {}, requestId: 'fixture' }; }
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}).listen(Number(process.env.FIXTURE_PORT || 48674), '127.0.0.1');
