import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const base = 'http://localhost:18100/lastochka';
const out = new URL('../../artifacts/recurring-calendar/screenshots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
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
      Origin: 'http://localhost:18100',
    },
    data: body,
  });
  expect(r.ok(), path + ' ' + (await r.text())).toBe(true);
  return r.json();
}
const projects = [
  'chromium-en-US-375',
  'chromium-en-US-1440',
  'chromium-ru-RU-375',
  'chromium-ru-RU-1440',
  'webkit-en-US-375',
  'webkit-en-US-1440',
  'webkit-ru-RU-375',
  'webkit-ru-RU-1440',
];
function date(offset: number) {
  const d = new Date(
    Date.now() +
      (700 +
        Number(process.env.RECURRING_RUN_OFFSET ?? 0) +
        projects.indexOf(test.info().project.name) * 35 +
        offset) *
        86400000,
  );
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}
function plus(d: string, n: number) {
  return new Date(Date.parse(d + 'T12:00:00+03:00') + n * 86400000).toISOString().slice(0, 10);
}
async function open(page: Page, d: string) {
  await page.goto(base + '/admin/schedule');
  await page.getByLabel('Дата', { exact: true }).fill(d);
  await expect(page.getByRole('button', { name: 'Группы', exact: true })).toBeVisible();
  await expect(page.getByText('Загрузка…', { exact: true })).toHaveCount(0);
}
async function closeSession(page: Page) {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Закрыть панель', exact: true })
    .click();
  const discard = page.getByRole('button', { name: 'Отбросить и выйти', exact: true });
  if (await discard.isVisible()) await discard.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
test.beforeEach(async ({ request, context }) => {
  execFileSync(
    'docker',
    [
      'exec',
      'lastochka-recurring-postgres',
      'psql',
      '-U',
      'lastochka',
      '-d',
      'lastochka_recurring',
      '-c',
      'DELETE FROM auth_limits;',
    ],
    { stdio: 'pipe' },
  );
  await command(request, '/api/v1/auth/password-stage', {
    login: 'recurring-admin',
    password: 'Fixture-pass-123',
  });
  await context.addCookies((await request.storageState()).cookies);
});

test('weekly group draft publishes atomically and removing Wednesday preserves dates', async ({
  page,
  request,
}, info) => {
  const d = date(0);
  await open(page, d);
  await page.getByRole('button', { name: 'Группы', exact: true }).click();
  const panel = page.getByRole('dialog');
  await panel.getByLabel('Название группы', { exact: true }).fill('Группа ' + info.project.name);
  await panel.getByRole('button', { name: 'Сохранить группу', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Группа сохранена');
  const groupId = await panel.getByRole('combobox', { name: 'Группа', exact: true }).inputValue();
  await panel.getByRole('button', { name: 'Создать расписание группы', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Пн', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await panel.getByLabel('Начать с даты').fill(d);
  await panel.getByLabel('Последняя дата').fill(plus(d, 25));
  await panel.getByLabel('Время начала', { exact: true }).fill('18:00');
  for (const name of ['Ср', 'Пт']) await panel.getByRole('button', { name, exact: true }).click();
  await panel.getByRole('button', { name: 'Проверить даты', exact: true }).click();
  await expect(panel.getByLabel('Предпросмотр серии')).toContainText('Добавится: 12');
  await panel.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Черновик серии сохранён');
  const from = new Date(d + 'T00:00:00+03:00').toISOString(),
    to = new Date(plus(d, 28) + 'T00:00:00+03:00').toISOString();
  const before = await (
    await request.get(base + '/api/v1/sessions', { params: { from, to, size: 100 } })
  ).json();
  expect(before.total).toBe(0);
  await panel.screenshot({ path: out + info.project.name + '-series-draft.png' });
  await panel.getByRole('button', { name: 'Закрыть панель', exact: true }).click();
  if (info.project.use.viewport!.width < 960)
    await page.getByRole('button', { name: 'Открыть черновик серии', exact: true }).first().click();
  else
    await page
      .getByRole('button', { name: /Черновик серии/ })
      .first()
      .click();
  await panel.getByRole('button', { name: 'Проверить даты', exact: true }).click();

  await panel.getByRole('button', { name: 'Опубликовать расписание', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Расписание опубликовано');
  await panel.getByRole('button', { name: 'Закрыть панель', exact: true }).click();
  await expect(panel).toHaveCount(0);
  const published = await (
    await request.get(base + '/api/v1/sessions', { params: { from, to, size: 100 } })
  ).json();
  expect(published.total).toBe(12);
  const ids = published.items.map((s: { id: string }) => s.id);
  expect(new Set(ids).size).toBe(12);
  await page.screenshot({ path: out + info.project.name + '-published.png', fullPage: true });
  await page.getByRole('button', { name: 'Группы', exact: true }).click();
  await panel.getByRole('combobox', { name: 'Группа', exact: true }).selectOption(groupId);
  await panel.getByRole('button', { name: 'Открыть расписание', exact: true }).click();
  await panel.getByRole('button', { name: 'Ср', exact: true }).click();
  await panel.getByLabel('Причина отмены дат').fill('Среды больше нет');
  await panel.getByRole('button', { name: 'Проверить даты', exact: true }).click();
  await expect(panel.getByLabel('Предпросмотр серии')).toContainText('отменится: 4');
  await panel.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Черновик серии сохранён');
  await panel.getByRole('button', { name: 'Опубликовать расписание', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Расписание опубликовано');
  const after = await (
    await request.get(base + '/api/v1/sessions', { params: { from, to, size: 100 } })
  ).json();
  expect(after.total).toBe(8);
  expect(after.items.every((s: { id: string }) => ids.includes(s.id))).toBe(true);
});

test('calendar click selection resize move and cancellation preserve the server', async ({
  page,
  request,
}, info) => {
  const d = date(400);
  await open(page, d);
  const desktop = page.locator('.calendar-desktop');
  if (info.project.use.viewport!.width < 960) {
    await page.getByRole('button', { name: 'Создать занятие на этот день', exact: true }).click();
    await expect(page.getByRole('dialog').getByLabel('Дата занятия · МСК')).toHaveValue(d);
    await closeSession(page);
    return;
  }
  await desktop.evaluate((el) => {
    el.scrollTop = 180;
  });
  const column = page.locator('.time-day').first();
  let box = (await column.boundingBox())!;
  const x = box.x + box.width / 2;
  await page.mouse.click(x, box.y + 360);
  let panel = page.getByRole('dialog');
  await expect(panel.getByLabel('Начало · МСК')).toHaveValue('14:00');
  await expect(panel.getByLabel('Длительность, минут')).toHaveValue('50');
  await closeSession(page);
  box = (await column.boundingBox())!;
  await page.mouse.move(x, box.y + 360);
  await page.mouse.down();
  await page.mouse.move(x, box.y + 420, { steps: 12 });
  await expect(page.locator('.calendar-ghost')).toContainText('14:00–15:00');
  await page.mouse.up();
  await expect(panel.getByLabel('Длительность, минут')).toHaveValue('60');
  await closeSession(page);
  const s = await command(request, '/api/v1/admin/sessions', {
    title: 'Жесты ' + info.project.name,
    format: 'GROUP',
    startsAt: new Date(d + 'T14:00:00+03:00').toISOString(),
    endsAt: new Date(d + 'T14:53:00+03:00').toISOString(),
    capacity: 8,
  });
  await open(page, d);
  await desktop.evaluate((el) => {
    el.scrollTop = 180;
  });
  box = (await column.boundingBox())!;
  const resize = page.locator(`[data-session-id="${s.id}"] .event-resize`);
  await resize.scrollIntoViewIfNeeded();
  const rb = (await resize.boundingBox())!;
  box = (await column.boundingBox())!;
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.mouse.down();
  await page.mouse.move(rb.x + rb.width / 2, box.y + 420, { steps: 10 });
  await page.mouse.up();
  await expect(panel.getByLabel('Начало · МСК')).toHaveValue('14:00');
  await expect(panel.getByLabel('Длительность, минут')).toHaveValue('60');
  await closeSession(page);
  const body = page.locator(`[data-session-id="${s.id}"] .calendar-event-body`);
  await body.scrollIntoViewIfNeeded();
  const eb = (await body.boundingBox())!,
    target = (await page.locator('.time-day').nth(1).boundingBox())!;
  await page.mouse.move(eb.x + 20, eb.y + 10);
  await page.mouse.down();
  await page.mouse.move(target.x + 40, target.y + 385, { steps: 15 });
  await page.mouse.up();
  await expect(panel.getByLabel('Дата занятия · МСК')).toHaveValue(plus(d, 1));
  await expect(panel.getByLabel('Длительность, минут')).toHaveValue('53');
  await closeSession(page);
  const after = await (
    await request.get(base + '/api/v1/admin/calendar', {
      params: {
        from: new Date(d + 'T00:00:00+03:00').toISOString(),
        to: new Date(plus(d, 7) + 'T00:00:00+03:00').toISOString(),
      },
    })
  ).json();
  expect(after.items.find((v: { id: string }) => v.id === s.id).startsAt).toBe(s.startsAt);
});

test('manual precise creation dirty exit focus and responsive geometry', async ({ page }, info) => {
  const d = date(800);
  await open(page, d);
  await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
  const panel = page.getByRole('dialog');
  await panel.getByLabel('Название', { exact: true }).fill('Точный ввод');
  await panel.getByLabel('Начало · МСК').fill('18:07');
  await panel.getByLabel('Длительность, минут').fill('53');
  await page.keyboard.press('Escape');
  await expect(panel.getByLabel('Несохранённые изменения')).toBeVisible();
  await panel.getByRole('button', { name: 'Продолжить редактирование', exact: true }).click();
  await expect(panel.getByLabel('Начало · МСК')).toHaveValue('18:07');
  await expect(panel.getByLabel('Длительность, минут')).toHaveValue('53');
  await closeSession(page);
  await expect(page.getByRole('button', { name: 'Создать занятие', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (info.project.use.viewport!.width === 1440) {
    const dimension = await page
      .locator('.time-day')
      .first()
      .evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        width: el.parentElement!.getBoundingClientRect().width,
      }));
    expect(dimension.height).toBe(840);
    expect(dimension.width).toBeLessThanOrEqual(1000);
    await page.locator('.calendar-desktop').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(page.locator('.time-axis span').last()).toHaveText('22:00');
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: out + info.project.name + '-large-text.png', fullPage: true });
});
