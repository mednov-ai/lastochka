// Isolated in-memory fixture for the enquiry form: no database, credentials or external network.
import http from 'node:http';
import { readFileSync } from 'node:fs';

const landingSql = readFileSync(
  new URL(
    '../../../backend/app/src/main/resources/db/migration/V3__landing_content.sql',
    import.meta.url,
  ),
  'utf8',
);
const landing = JSON.parse(landingSql.match(/VALUES \(1,1,1,'(.*)'::jsonb\)/s)[1]);

// mode: full | empty | error | age-error | conflict | archived | down
let mode = 'full';
let last = null;
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
const id = (n) => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`;
const json = (res, status, body) =>
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
const problem = (status, code, detail, fieldErrors = {}) => ({
  status,
  code,
  detail,
  fieldErrors,
  requestId: 'fixture',
});

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (url.pathname === '/__fixture/state') return json(res, 200, { mode, last });
      if (url.pathname === '/__fixture/mode') {
        mode = url.searchParams.get('mode') || 'full';
        last = null;
        return json(res, 200, { mode });
      }
      if (url.pathname.endsWith('/api/v1/public/landing')) return json(res, 200, landing);
      if (url.pathname.endsWith('/api/v1/public/schedule/weekly')) {
        if (mode === 'error' || mode === 'age-error')
          return json(res, 503, { code: 'UNAVAILABLE' });
        const intervals =
          mode === 'empty'
            ? []
            : [
                {
                  reference: { seriesId: directions[0].id, revision: 3 },
                  directionId: directions[0].id,
                  weekday: 3,
                  startMinute: 1020,
                  durationMinutes: 45,
                },
                ...[1, 2, 3, 4, 5, 6, 7, 8, 20, 21, 22].map((n, i) => ({
                  reference: { seriesId: id(n), revision: 1 },
                  directionId: directions[n < 20 ? 1 : n < 22 ? 2 : 3].id,
                  weekday: 1 + (i % 7),
                  startMinute: 480 + 60 * i,
                  durationMinutes: 45,
                })),
              ];
        return json(res, 200, { directions, intervals });
      }
      if (url.pathname.endsWith('/api/v1/public/age-directions'))
        return mode === 'age-error'
          ? json(res, 503, problem(503, 'SERVICE_UNAVAILABLE', 'Недоступно.'))
          : json(res, 200, { items: directions });
      if (url.pathname.endsWith('/api/v1/auth/csrf'))
        return json(res, 200, {
          headerName: 'X-CSRF-TOKEN',
          parameterName: '_csrf',
          token: 'fixture',
        });
      if (url.pathname.endsWith('/api/v1/auth/me')) return json(res, 200, { state: 'ANONYMOUS' });
      if (url.pathname.endsWith('/api/v1/enquiries') && req.method === 'POST') {
        const body = JSON.parse(raw || '{}');
        if (mode === 'down')
          return json(res, 503, problem(503, 'SERVICE_UNAVAILABLE', 'Сервис недоступен.'));
        if (mode === 'archived')
          return json(
            res,
            400,
            problem(400, 'VALIDATION', 'Проверьте поля.', {
              ageDirectionId: 'Выберите возрастную категорию из списка.',
            }),
          );
        if (mode === 'weekly-conflict' && body.weeklyPreference)
          return json(
            res,
            409,
            problem(409, 'VERSION_CONFLICT', 'Условия выбранного занятия изменились.'),
          );
        last = { body, key: req.headers['idempotency-key'] };
        return json(res, 200, { number: 42, createdAt: new Date().toISOString() });
      }
      return json(res, 404, problem(404, 'NOT_FOUND', 'Не найдено.'));
    });
  })
  .listen(Number(process.env.FIXTURE_PORT || 48797), '127.0.0.1');
