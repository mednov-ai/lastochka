import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const base = (process.env.TEST_APP_URL ?? 'http://localhost:18094/lastochka').replace(/\/$/, '');
const out = new URL('../../artifacts/schedule-editor/screenshots', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
function sql(query: string) {
  if (
    base !== 'http://localhost:18094/lastochka' ||
    process.env.TEST_DATABASE_CONTAINER !== 'lastochka-editor-postgres'
  )
    throw Error('Isolated schedule editor database required');
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'lastochka-editor-postgres',
      'psql',
      '-U',
      'lastochka',
      '-d',
      'lastochka_editor',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: query, encoding: 'utf8' },
  );
}
async function command(
  request: APIRequestContext,
  path: string,
  body: unknown,
  method: 'post' | 'put' = 'post',
) {
  const c = await (await request.get(base + '/api/v1/auth/csrf')).json();
  const r = await request[method](base + path, {
    headers: {
      [c.headerName]: c.token,
      'Idempotency-Key': crypto.randomUUID(),
      Origin: new URL(base).origin,
    },
    data: body,
  });
  expect(r.ok(), path + ' ' + r.status()).toBe(true);
  return r.json();
}
async function login(request: APIRequestContext) {
  sql('DELETE FROM auth_limits;');
  const c = await (await request.get(base + '/api/v1/auth/csrf')).json();
  expect(
    (
      await request.post(base + '/api/v1/auth/password-stage', {
        headers: { [c.headerName]: c.token },
        data: { login: 'editor-admin', password: 'Fixture-pass-123' },
      })
    ).ok(),
  ).toBe(true);
}
function tomorrow(offset = 1) {
  return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
}
async function seed(request: APIRequestContext, title: string, day: number, time = '10:00') {
  const start = tomorrow(day) + 'T' + time + ':00+03:00';
  const draft = await command(request, '/api/v1/admin/sessions', {
    title,
    format: 'GROUP',
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(new Date(start).valueOf() + 3000000).toISOString(),
    capacity: 6,
    ageFrom: 7,
    ageTo: 10,
    replaceAgeRange: true,
  });
  return command(request, `/api/v1/admin/sessions/${draft.id}/actions`, {
    expectedVersion: draft.version,
    action: 'PUBLISH',
  });
}
async function contacts(page: Page) {
  await page.getByLabel('Имя родителя', { exact: true }).fill('Родитель проверки');
  await page.getByLabel('Телефон', { exact: true }).fill('9001234567');
  await page.getByLabel('Комментарий — необязательно').fill('Сохранить при выборе');
}
async function intact(page: Page) {
  await expect(page.getByLabel('Имя родителя', { exact: true })).toHaveValue('Родитель проверки');
  await expect(page.getByLabel('Комментарий — необязательно')).toHaveValue('Сохранить при выборе');
}
test.beforeEach(async ({ request, context }) => {
  await login(request);
  await context.addCookies((await request.storageState()).cookies);
});
test('editor preserves input, publishes, highlights period and restores history', async ({
  page,
  request,
}, info) => {
  const n = info.project.name;
  const title = 'Редактор ' + n;
  const day = tomorrow(
    40 +
      [
        'chromium-en-US-375',
        'chromium-en-US-1440',
        'chromium-ru-RU-375',
        'chromium-ru-RU-1440',
        'webkit-en-US-375',
        'webkit-en-US-1440',
        'webkit-ru-RU-375',
        'webkit-ru-RU-1440',
      ].indexOf(info.project.name),
  );
  await page.goto(base + '/admin/schedule');
  await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
  const panel = page.getByRole('dialog');
  await panel.getByLabel('Название', { exact: true }).fill(title);
  await panel.getByLabel('Дата занятия · МСК').fill(day);
  await panel.getByLabel('Начало · МСК').fill('17:00');
  await expect(panel.getByLabel('Длительность, минут')).toHaveValue('50');
  await panel.getByLabel('Формат', { exact: true }).selectOption('INDIVIDUAL');
  await expect(panel.getByLabel('Размер группы')).toHaveCount(0);
  await panel.getByLabel('Формат', { exact: true }).selectOption('GROUP');
  await expect(panel.getByLabel('Размер группы')).toHaveValue('8');
  await panel.getByLabel('От, лет', { exact: true }).fill('7');
  await panel.getByLabel('До, лет', { exact: true }).fill('10');
  await panel.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Черновик сохранён');
  await expect(page.getByLabel('Дата', { exact: true })).toHaveValue(day);
  await panel.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await panel.getByRole('button', { name: 'Вернуться к форме', exact: true }).click();
  await expect(panel.getByLabel('Название', { exact: true })).toHaveValue(title);
  await panel.getByRole('button', { name: 'Опубликовать', exact: true }).click();
  await panel.getByRole('button', { name: 'Подтвердить публикацию', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('опубликовано');
  await panel.getByLabel('Название', { exact: true }).fill(title + ' изменено');
  await panel.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('прежние условия');
  const id = await page.locator('.calendar-event.selected').getAttribute('data-session-id');
  expect(id).toBeTruthy();
  const publicBefore = await (await request.get(base + '/api/v1/sessions/' + id)).json();
  expect(publicBefore.title).toBe(title);
  await panel.getByRole('button', { name: 'Опубликовать изменения', exact: true }).click();
  await panel.getByRole('button', { name: 'Вернуться к форме', exact: true }).click();
  await expect(panel.getByLabel('Название', { exact: true })).toHaveValue(title + ' изменено');
  await panel.getByRole('button', { name: 'Предпросмотр', exact: true }).click();
  await expect(panel.getByLabel('Предпросмотр занятия')).toContainText(title + ' изменено');
  await page.screenshot({ path: out + '/' + n + '-editor.png', fullPage: true });
  await panel.getByRole('button', { name: 'Опубликовать изменения', exact: true }).click();
  await panel.getByRole('button', { name: 'Подтвердить публикацию', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Изменения опубликованы');
  await panel.getByRole('button', { name: 'История изменений', exact: true }).click();
  await expect(panel.getByText('Сохранённые версии', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Закрыть панель', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.goto(base + '/#schedule');
  await page.getByLabel('Дата', { exact: true }).fill(day);
  await expect(page.getByRole('heading', { name: title + ' изменено', exact: true })).toBeVisible();
  await page.screenshot({ path: out + '/' + n + '-published.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
test('enquiry preselection can change without losing fields and conflicts require decision', async ({
  page,
  request,
}, info) => {
  const idx = info.project.name.includes('webkit') ? 20 : 0;
  const shift =
    idx +
    (info.project.name.includes('ru-RU') ? 10 : 0) +
    (info.project.name.includes('1440') ? 2 : 0);
  const day = 7 + shift;
  const first = await seed(request, 'Выбор А ' + info.project.name, day, '09:00');
  const second = await seed(request, 'Выбор Б ' + info.project.name, day, '11:00');
  await page.goto(base + '/enquiry?session=' + first.id);
  await expect(page.getByLabel('Желаемое занятие')).toContainText(first.title);
  await expect(page.getByLabel('Выбор из расписания')).toBeHidden();
  await contacts(page);
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  await expect(page.getByLabel('Выбор из расписания')).toBeVisible();
  await intact(page);
  await page.getByLabel('Показать с', { exact: true }).fill(tomorrow(day));
  await page.getByRole('button', { name: 'Показать занятия', exact: true }).click();
  const card = page
    .getByLabel('Выбор из расписания')
    .getByRole('article')
    .filter({ hasText: second.title });
  await card.getByRole('button', { name: 'Выбрать это занятие', exact: true }).click();
  await intact(page);
  await expect(page.getByLabel('Желаемое занятие')).toContainText(second.title);
  await command(
    request,
    '/api/v1/admin/sessions/' + second.id,
    {
      expectedVersion: second.version,
      session: { ...second, title: second.title + ' новое время' },
    },
    'put',
  );
  await page.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
  await expect(page.getByText('Условия изменились.', { exact: false })).toBeVisible();
  await intact(page);
  await page.screenshot({
    path: out + '/' + info.project.name + '-selection-conflict.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Выбрать актуальные условия', exact: true }).click();
  await page.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Заявка принята', exact: true })).toBeVisible();
});
test('no-JS selection keeps partial fields, pagination does not submit and general enquiry works', async ({
  browser,
  request,
}, info) => {
  const s = await seed(
    request,
    'Без сценариев ' + info.project.name,
    60 +
      (info.project.name.includes('webkit') ? 10 : 0) +
      (info.project.name.includes('ru-RU') ? 3 : 0) +
      (info.project.name.includes('1440') ? 1 : 0),
  );
  const context = await browser.newContext({
    javaScriptEnabled: false,
    locale: info.project.use.locale,
    viewport: info.project.use.viewport,
    timezoneId: 'Asia/Tokyo',
  });
  const page = await context.newPage();
  await page.goto(base + '/enquiry?session=' + s.id);
  await contacts(page);
  await page.getByRole('button', { name: 'Изменить', exact: true }).click();
  await intact(page);
  await page.getByRole('button', { name: 'Следующая неделя', exact: true }).click();
  await intact(page);
  await page.getByRole('button', { name: 'Помогите подобрать время', exact: true }).click();
  await intact(page);
  await expect(page.getByLabel('Желаемое занятие')).toContainText('Помогите подобрать время');
  expect(page.url()).not.toContain('Родитель');
  await page.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Заявка принята', exact: true })).toBeVisible();
  await context.close();
});

test('editor guards dirty input, resolves a conflict and prepares history restoration', async ({
  page,
  request,
}, info) => {
  const index = [
    'chromium-en-US-375',
    'chromium-en-US-1440',
    'chromium-ru-RU-375',
    'chromium-ru-RU-1440',
    'webkit-en-US-375',
    'webkit-en-US-1440',
    'webkit-ru-RU-375',
    'webkit-ru-RU-1440',
  ].indexOf(info.project.name);
  const s = await seed(request, 'Защита ввода ' + info.project.name, 100 + index);
  await page.goto(base + '/admin/schedule');
  await page.getByLabel('Дата', { exact: true }).fill(tomorrow(100 + index));
  await page.getByRole('combobox', { name: /Вид/ }).selectOption('list');
  await page
    .getByRole('article')
    .filter({ hasText: s.title })
    .getByRole('button', { name: 'Открыть занятие', exact: true })
    .click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByLabel('Название', { exact: true })).toHaveValue(s.title);
  const mine = s.title + ' мой ввод';
  await panel.getByLabel('Название', { exact: true }).fill(mine);
  await panel.getByRole('button', { name: 'Закрыть панель', exact: true }).click();
  await expect(
    panel.getByRole('heading', { name: 'Сохранить изменения перед выходом?', exact: true }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Продолжить редактирование', exact: true }).click();
  await expect(panel.getByLabel('Название', { exact: true })).toHaveValue(mine);
  await command(
    request,
    '/api/v1/admin/sessions/' + s.id,
    { expectedVersion: s.version, session: { ...s, title: s.title + ' другая версия' } },
    'put',
  );
  await panel.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(
    panel.getByRole('heading', { name: 'Актуальные сохранённые условия', exact: true }),
  ).toBeVisible();
  await expect(panel.getByLabel('Название', { exact: true })).toHaveValue(mine);
  await panel
    .getByRole('button', { name: 'Принять актуальную основу и сохранить мой ввод', exact: true })
    .click();
  await panel.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Черновик сохранён');
  await panel.getByRole('button', { name: 'История изменений', exact: true }).click();
  const old = panel
    .locator('.editor-history article')
    .filter({ has: page.getByRole('heading', { name: 'Создан черновик', exact: true }) });
  await old.getByRole('button', { name: 'Подготовить восстановление', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Прежние параметры');
  await expect(panel.getByLabel('Название', { exact: true })).toHaveValue(s.title);
  const actual = await (await request.get(base + '/api/v1/sessions/' + s.id)).json();
  expect(actual.title).toBe(s.title + ' другая версия');
  await page.setViewportSize({ width: 320, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});
