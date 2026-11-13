// Isolated in-memory fixture for the client-review polish: no database, credentials or external network.
import http from 'node:http';
import { readFileSync } from 'node:fs';

const landingSql = readFileSync(
  new URL(
    '../../../backend/app/src/main/resources/db/migration/V3__landing_content.sql',
    import.meta.url,
  ),
  'utf8',
);
const original = JSON.parse(landingSql.match(/VALUES \(1,1,1,'(.*)'::jsonb\)/s)[1]);
const replacedIntro =
  'Движение, игра и упражнения в комфортном темпе. Подберём занятия по возрасту и уровню подготовки.';
const intro = { replaced: replacedIntro, custom: 'Свой текст студии о занятиях.' };

// mode: full | partial | gap | empty | many | error | age-error; intro: original | replaced | custom
let mode = 'full';
let introMode = 'replaced';
const directions = [
  ['3–5 лет', 3, 5],
  ['6–7 лет', 6, 7],
  ['8–9 лет', 8, 9],
  ['10–13 лет', 10, 13],
  ['14+ лет', 14, null],
].map(([title, ageFrom, ageTo], index) => ({
  id: `b8c0a000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  title,
  description: 'Тестовое описание',
  ageFrom,
  ageTo,
  ageOpenEnded: ageTo === null,
  active: true,
  sortOrder: index + 1,
  version: 0,
}));
const id = (n) => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`;
/** Sessions are placed relative to the requested week so every week looks the same. */
function week(from) {
  const monday = new Date(from).valueOf();
  const at = (day, hour, minute = 0) =>
    new Date(monday + day * 86400000 + (hour * 60 + minute) * 60000);
  const session = (n, day, hour, age, extra = {}) => {
    const start = at(day, hour),
      d = age === null ? null : directions[age];
    return {
      kind: 'SESSION',
      session: {
        id: id(n),
        title: d ? d.title : 'Индивидуальное занятие',
        format: d ? 'GROUP' : 'INDIVIDUAL',
        startsAt: start.toISOString(),
        endsAt: new Date(start.valueOf() + 3600000).toISOString(),
        capacity: d ? 8 : 1,
        ageFrom: d?.ageFrom ?? null,
        ageTo: d?.ageTo ?? null,
        ageOpenEnded: d?.ageOpenEnded ?? false,
        status: 'OPEN',
        version: 1,
        zone: 'Europe/Moscow',
        ...extra,
      },
    };
  };
  if (mode === 'empty') return [];
  if (mode === 'gap') {
    // Like the real API after Tuesday and Thursday passed: 6–7 is absent only in the current
    // week and returns the next one; 14+ has no sessions at all.
    const current = Date.now() >= monday && Date.now() < monday + 7 * 86400000;
    return [
      session(1, 0, 17, 0),
      session(2, 2, 17, 0),
      ...(current ? [] : [session(3, 1, 17, 1), session(4, 3, 17, 1)]),
      session(5, 1, 18, 2),
      session(6, 3, 18, 3),
    ];
  }
  if (mode === 'partial')
    return [session(1, 0, 17, 0), session(2, 2, 17, 0), session(3, 1, 18, 2), session(4, 3, 18, 2)];
  if (mode === 'many')
    return Array.from({ length: 26 }, (_, n) =>
      session(n + 1, n % 6, 9 + Math.floor(n / 6) * 2, n % 5),
    );
  return [
    session(1, 0, 17, 0),
    session(2, 2, 17, 0),
    session(3, 4, 17, 0),
    session(4, 1, 17, 1),
    session(5, 3, 17, 1),
    session(6, 0, 18, 2),
    session(7, 2, 18, 2),
    session(8, 4, 18, 2, { status: 'CLOSED' }),
    session(9, 1, 18, 3),
    session(10, 3, 18, 3),
    session(11, 5, 11, 3),
    session(12, 1, 19, 4),
    session(13, 5, 12, 4),
    session(14, 5, 10, null),
  ];
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let status = 200,
      body = {};
    if (url.pathname === '/__fixture/state') body = { mode, introMode };
    else if (url.pathname === '/__fixture/mode') {
      mode = url.searchParams.get('mode') || mode;
      introMode = url.searchParams.get('intro') || introMode;
      body = { mode, introMode };
    } else if (url.pathname.endsWith('/api/v1/public/landing')) {
      body = structuredClone(original);
      const hero = body.blocks.find((block) => block.id === 'hero');
      if (introMode !== 'original') hero.text = intro[introMode];
    } else if (url.pathname.endsWith('/api/v1/public/age-directions')) {
      if (mode === 'age-error') {
        status = 503;
        body = { code: 'SERVICE_UNAVAILABLE' };
      } else body = { items: directions };
    } else if (url.pathname.endsWith('/api/v1/auth/csrf'))
      body = { headerName: 'X-CSRF-TOKEN', parameterName: '_csrf', token: 'fixture' };
    else if (url.pathname.endsWith('/api/v1/auth/me')) body = { state: 'ANONYMOUS' };
    else if (url.pathname.endsWith('/api/v1/public/schedule')) {
      const page = Number(url.searchParams.get('page') || 0),
        size = Number(url.searchParams.get('size') || 20);
      const all = week(url.searchParams.get('from')).sort((a, b) =>
        a.session.startsAt.localeCompare(b.session.startsAt),
      );
      body = {
        items: all.slice(page * size, (page + 1) * size),
        page,
        size,
        total: all.length,
        containsCalculated: false,
      };
      if (mode === 'error') {
        status = 503;
        body = {
          status,
          code: 'SERVICE_UNAVAILABLE',
          detail: 'Расписание временно недоступно.',
          fieldErrors: {},
          requestId: 'fixture',
        };
      }
    } else if (/\/api\/v1\/sessions\/[0-9a-f-]+$/.test(url.pathname)) {
      const start = new Date(Date.now() + 4 * 86400000);
      body = {
        id: url.pathname.split('/').pop(),
        title: '8–9 лет',
        format: 'GROUP',
        startsAt: start.toISOString(),
        endsAt: new Date(start.valueOf() + 3600000).toISOString(),
        capacity: 8,
        ageFrom: 8,
        ageTo: 9,
        ageOpenEnded: false,
        status: 'OPEN',
        version: 1,
        zone: 'Europe/Moscow',
      };
    } else {
      status = 404;
      body = {
        status,
        code: 'NOT_FOUND',
        detail: 'Не найдено.',
        fieldErrors: {},
        requestId: 'fixture',
      };
    }
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  })
  .listen(Number(process.env.FIXTURE_PORT || 48794), '127.0.0.1');
