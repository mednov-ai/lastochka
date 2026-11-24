// Isolated in-memory fixture for the landing ribbon: no database, credentials or external network.
import http from 'node:http';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL(
    '../../../backend/app/src/main/resources/db/migration/V3__landing_content.sql',
    import.meta.url,
  ),
  'utf8',
);
const original = JSON.parse(sql.match(/VALUES \(1,1,1,'(.*)'::jsonb\)/s)[1]);
const ages = [
  '3–5 лет',
  '6–7 лет',
  '8–9 лет',
  '10–13 лет',
  '14+ лет',
  '16+ лет',
  '18+ лет',
  '21+ лет',
];
// weekday, start minute, duration and direction index, like the published test schedule
const slots = [
  [1, 1020, 45, 0],
  [3, 1020, 45, 0],
  [5, 1020, 45, 0],
  [6, 750, 45, 0],
  [2, 1020, 50, 1],
  [4, 1020, 50, 1],
  [1, 1080, 60, 2],
  [3, 1080, 60, 2],
  [5, 1080, 60, 2],
  [2, 1080, 60, 3],
  [4, 1080, 60, 3],
  [6, 675, 60, 3],
  [2, 1155, 60, 4],
  [6, 600, 60, 4],
];
// content: normal | long | hidden | moved; schedule: full | empty | error | slow
let state = { content: 'normal', schedule: 'full', count: 5 };
const id = (p, n) => `${p}-0000-4000-8000-${String(n + 1).padStart(12, '0')}`;

function landing() {
  const body = structuredClone(original);
  if (state.content === 'long')
    for (const b of body.blocks) {
      b.title = `${b.title} Дополнительный длинный заголовок раздела`;
      b.text = `${b.text} ${'Подробное описание занятий для родителей. '.repeat(8)}`;
    }
  if (state.content === 'hidden')
    for (const b of body.blocks)
      if (['approach', 'coach', 'contacts'].includes(b.kind)) b.visible = false;
  if (state.content === 'moved') {
    const at = body.blocks.findIndex((b) => b.kind === 'coach');
    const [coach] = body.blocks.splice(at, 1);
    body.blocks.splice(1, 0, coach);
  }
  return body;
}
function weekly() {
  const directions = ages.slice(0, state.count).map((title, i) => ({
    id: id('b8c0a000', i),
    title,
    description: 'Тестовое описание',
    ageFrom: [3, 6, 8, 10, 14, 16, 18, 21][i],
    ageTo: [5, 7, 9, 13][i] ?? null,
    ageOpenEnded: i > 3,
    active: true,
    sortOrder: i,
    version: 0,
  }));
  const intervals =
    state.schedule === 'empty'
      ? []
      : slots
          .filter((s) => s[3] < state.count)
          .map(([weekday, startMinute, durationMinutes, d], i) => ({
            reference: { seriesId: id('cccccccc', i), revision: 1 },
            directionId: directions[d].id,
            weekday,
            startMinute,
            durationMinutes,
          }));
  return { directions, intervals };
}
http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let status = 200,
      body = {};
    if (url.pathname === '/__fixture/state') body = state;
    else if (url.pathname === '/__fixture/mode')
      body = state = {
        content: url.searchParams.get('content') || 'normal',
        schedule: url.searchParams.get('schedule') || 'full',
        count: Number(url.searchParams.get('count') || 5),
      };
    else if (url.pathname.endsWith('/public/landing')) body = landing();
    else if (url.pathname.endsWith('/public/schedule/weekly')) {
      body = weekly();
      if (state.schedule === 'error') {
        status = 503;
        body = { code: 'UNAVAILABLE' };
      }
    } else if (url.pathname.endsWith('/public/age-directions'))
      body = { items: weekly().directions };
    else if (url.pathname.endsWith('/auth/csrf'))
      body = { headerName: 'X-CSRF-TOKEN', parameterName: '_csrf', token: 'fixture' };
    else if (url.pathname.endsWith('/auth/me')) body = { state: 'ANONYMOUS' };
    else {
      status = 404;
      body = { status, code: 'NOT_FOUND' };
    }
    const send = () =>
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (state.schedule === 'slow' && url.pathname.includes('weekly')) setTimeout(send, 2000);
    else send();
  })
  .listen(Number(process.env.FIXTURE_PORT || 48894), '127.0.0.1');
