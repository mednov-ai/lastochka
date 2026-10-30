import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const base = 'http://localhost:18111/lastochka';
const origins = ['chromium-375', 'chromium-1440', 'webkit-375', 'webkit-1440'];
const run = process.env.WEEKLY_RUN_OFFSET ?? '0';
function monday(offset: number) {
  const day = new Date(
    Date.UTC(
      2051,
      0,
      2 +
        origins.indexOf(test.info().project.name) * 1200 +
        offset * 90 +
        Number(process.env.WEEKLY_RUN_OFFSET ?? 0),
    ),
  );
  day.setUTCDate(day.getUTCDate() + ((8 - day.getUTCDay()) % 7));
  return day.toISOString().slice(0, 10);
}
function plus(day: string, count: number) {
  const value = new Date(day + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}
function currentMoscowMonday() {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
  const day = new Date(date + 'T12:00:00Z').getUTCDay();
  return plus(date, -((day + 6) % 7));
}
async function command(request: APIRequestContext, path: string, data: unknown) {
  const csrf = await (await request.get(base + '/api/v1/auth/csrf')).json();
  const response = await request.post(base + path, {
    headers: {
      [csrf.headerName]: csrf.token,
      'Idempotency-Key': crypto.randomUUID(),
      Origin: 'http://localhost:18111',
    },
    data,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function list(request: APIRequestContext, path: string) {
  const response = await request.get(base + path);
  expect(response.ok()).toBeTruthy();
  return (await response.json()).items;
}
async function openNew(page: Page, date: string) {
  await page.goto(base + '/admin/schedule');
  await page.getByLabel('Дата', { exact: true }).fill(date);
  await expect(page.getByRole('button', { name: 'Создать занятие', exact: true })).toBeVisible();
  await expect(page.getByText('Загрузка…', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
  return page.getByRole('dialog', { name: 'Новое занятие', exact: true });
}
async function startWeekly(page: Page, date: string, title: string) {
  const panel = await openNew(page, date);
  await panel.getByLabel('Название', { exact: true }).pressSequentially(title, { delay: 5 });
  await panel.getByRole('button', { name: 'Еженедельно · выбрать дни' }).click();
  await expect(panel.getByRole('group', { name: 'Дни повторения' })).toBeVisible();
  return panel;
}
test.beforeEach(async ({ request, context }) => {
  execFileSync('docker', [
    'exec',
    'lastochka-new-weekly-postgres',
    'psql',
    '-U',
    'lastochka',
    '-d',
    'lastochka_weekly_fixture',
    '-c',
    'DELETE FROM auth_limits;',
  ]);
  await command(request, '/api/v1/auth/password-stage', {
    login: 'weekly-admin',
    password: 'Fixture-pass-123',
  });
  await context.addCookies((await request.storageState()).cookies);
});

test('new past dates in the current Moscow week can be checked and published', async ({
  page,
  request,
}) => {
  const date = currentMoscowMonday();
  const title = 'Текущая неделя ' + test.info().project.name;
  const panel = await startWeekly(page, date, title);
  await panel.getByLabel('Начало · МСК').fill(`0${origins.indexOf(test.info().project.name)}:00`);
  await panel.getByLabel('Последняя дата повторения · МСК').fill(plus(date, 25));
  await panel.getByRole('button', { name: 'Среда', exact: true }).click();
  await panel.getByRole('button', { name: 'Пятница', exact: true }).click();
  await panel.getByRole('button', { name: 'Проверить расписание' }).click();
  const plan = panel.getByLabel('Предпросмотр серии');
  await expect(plan).toContainText('Всего дат: 12');
  await expect(plan.getByRole('table', { name: 'Даты и ошибки плана' })).toBeVisible();
  await expect(plan).toContainText('Нет ошибок');
  await expect(panel.getByRole('button', { name: 'Опубликовать расписание' })).toBeEnabled();
  await panel.getByRole('button', { name: 'Назад к параметрам' }).focus();
  await page.keyboard.press('Enter');
  await expect(panel.getByLabel('Название', { exact: true })).toHaveValue(title);
  await expect(panel.getByRole('button', { name: 'Среда', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await panel.getByRole('button', { name: 'Проверить расписание' }).click();
  await panel.getByRole('button', { name: 'Опубликовать расписание' }).click();
  await expect(panel.getByRole('status')).toContainText('Расписание опубликовано');
  const rows = await list(request, '/api/v1/admin/session-series');
  expect(rows.some((row: { rule?: { title?: string } }) => row.rule?.title === title)).toBeTruthy();
});

test('mixed and unknown reasons stay visible across plan pages', async ({ page }) => {
  await page.route('**/api/v1/admin/session-series/new-group/preview', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.items[0].conflictCodes = [
      'SERIES_BEFORE_CURRENT_WEEK',
      'SCHEDULE_CONFLICT',
      'FUTURE_UNKNOWN',
    ];
    data.items[0].conflict = 'Другая причина проверки.';
    data.items[11].conflictCodes = ['SCHEDULE_CONFLICT'];
    data.items[11].conflict = 'Это время уже занято другим занятием.';
    data.canPublish = false;
    await route.fulfill({ response, json: data });
  });
  const date = monday(9);
  const panel = await startWeekly(page, date, 'Проверка причин');
  await panel.getByLabel('Начало · МСК').fill('17:00');
  await panel.getByLabel('Последняя дата повторения · МСК').fill(plus(date, 25));
  await panel.getByRole('button', { name: 'Среда', exact: true }).click();
  await panel.getByRole('button', { name: 'Пятница', exact: true }).click();
  await panel.getByRole('button', { name: 'Проверить расписание' }).click();
  const plan = panel.getByLabel('Предпросмотр серии');
  await expect(plan).toContainText('Дата занятия раньше текущей недели');
  await expect(plan).toContainText('Это время уже занято другим занятием');
  await expect(plan).toContainText('Другая причина проверки');
  await expect(plan.getByRole('columnheader')).toHaveCount(3);
  await expect(plan.getByRole('table')).toContainText('Нет ошибок');
  await panel.screenshot({ path: test.info().outputPath('plan-table.png') });
  const originalSize = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const table = plan.getByRole('table');
  await table.scrollIntoViewIfNeeded();
  await expect(table.getByRole('columnheader')).toHaveCount(3);
  await expect(table.getByRole('rowheader')).toHaveCount(10);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  expect(await table.evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
  await panel.screenshot({ path: test.info().outputPath('plan-table-320-200.png') });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await page.setViewportSize(originalSize);
  await panel.getByRole('button', { name: 'Следующие даты' }).click();
  await expect(plan).toContainText('Это время уже занято другим занятием');
  await panel.getByRole('button', { name: 'К первому конфликту' }).focus();
  await page.keyboard.press('Enter');
  await expect(plan).toContainText('Дата занятия раньше текущей недели');
  await expect(plan.locator('tr[data-conflict="true"]').first()).toBeFocused();
  await expect(panel.getByRole('button', { name: 'Опубликовать расписание' })).toBeDisabled();
});

test('an older server response still explains a past start', async ({ page }) => {
  await page.route('**/api/v1/admin/session-series/new-group/preview', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    for (const item of data.items) delete item.conflictCodes;
    data.items[0].conflict = 'Укажите будущее время начала занятия по Москве.';
    data.canPublish = false;
    await route.fulfill({ response, json: data });
  });
  const panel = await startWeekly(page, '2026-10-29', 'Проверка совместимости');
  await panel.getByLabel('Начало · МСК').fill('17:00');
  await panel.getByRole('button', { name: 'Проверить расписание' }).click();
  await expect(panel.getByLabel('Предпросмотр серии')).toContainText('Укажите будущее время');
  await expect(panel.getByRole('button', { name: 'Опубликовать расписание' })).toBeDisabled();
});

test('dialog close stays centred and the larger window fits the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const panel = await startWeekly(page, monday(10), 'Проверка окна');
  const close = panel.getByRole('button', { name: 'Закрыть панель' });
  async function geometry() {
    return close.evaluate((button) => {
      const b = button.getBoundingClientRect();
      const s = button.querySelector('span')!.getBoundingClientRect();
      return {
        x: Math.abs((b.left + b.right - s.left - s.right) / 2),
        y: Math.abs((b.top + b.bottom - s.top - s.bottom) / 2),
        w: b.width,
        h: b.height,
      };
    });
  }
  const frame = await panel.boundingBox();
  expect(frame!.height).toBeCloseTo(720, 0);
  expect(frame!.y).toBeCloseTo(110, 0);
  for (const action of ['idle', 'hover', 'focus', 'active'] as const) {
    if (action === 'hover') await close.hover();
    if (action === 'focus') await close.focus();
    if (action === 'active') await page.mouse.down();
    const g = await geometry();
    expect(g.x, action).toBeLessThanOrEqual(1);
    expect(g.y, action).toBeLessThanOrEqual(1);
    expect(g.w).toBeGreaterThanOrEqual(44);
    expect(g.h).toBeGreaterThanOrEqual(44);
    if (action === 'active') {
      await page.mouse.move(1, 1);
      await page.mouse.up();
    }
  }
  await panel.screenshot({ path: test.info().outputPath('window-720.png') });
  await page.setViewportSize({ width: 320, height: 400 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const small = await panel.boundingBox();
  expect(small!.x).toBeGreaterThanOrEqual(0);
  expect(small!.y).toBeGreaterThanOrEqual(0);
  expect(small!.y + small!.height).toBeLessThanOrEqual(400);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await expect(close).toBeVisible();
  await close.click();
  await expect(page.getByRole('dialog', { name: 'Выйти без сохранения?' })).toBeVisible();
});

test('start passing after preview leaves the draft and tells the administrator what to do', async ({
  page,
}) => {
  const date = monday(7);
  const panel = await startWeekly(page, date, 'Проверка времени');
  await panel.getByRole('button', { name: 'Проверить расписание' }).click();
  await page.route('**/api/v1/admin/session-series/*/publish', async (route) => {
    await route.fulfill({
      status: 409,
      contentType: 'application/problem+json',
      json: {
        status: 409,
        code: 'SERIES_START_PASSED',
        detail:
          'Начало занятия уже наступило. Вернитесь к параметрам и измените дату или время, затем проверьте расписание снова.',
        fieldErrors: {},
      },
    });
  });
  await panel.getByRole('button', { name: 'Опубликовать расписание' }).click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toContainText('Начало занятия уже наступило');
  await expect(dialog.getByRole('button', { name: 'Опубликовать расписание' })).toBeDisabled();
  const dismiss = dialog.getByRole('button', { name: 'Закрыть уведомление' });
  if (await dismiss.isVisible()) await dismiss.click();
  await dialog.getByRole('button', { name: 'Назад к параметрам' }).click();
  await expect(dialog.getByLabel('Название', { exact: true })).toHaveValue('Проверка времени');
});

test('the same form previews without writes, then publishes one complete series', async ({
  page,
  request,
}) => {
  const date = monday(0),
    title = 'Малышарики ' + test.info().project.name + ' ' + run;
  const beforeGroups = await list(request, '/api/v1/admin/schedule-groups');
  const beforeSeries = await list(request, '/api/v1/admin/session-series');
  const panel = await startWeekly(page, date, title);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(panel.getByLabel('Название', { exact: true })).toHaveValue(title);
  await expect(panel.getByLabel('Название группы', { exact: true })).toHaveCount(0);
  await panel.getByLabel('Длительность, минут').fill('53');
  await panel.getByLabel('Размер группы').fill('6');
  await panel.getByLabel('Последняя дата повторения · МСК').fill(plus(date, 25));
  await panel.getByRole('button', { name: 'Среда', exact: true }).click();
  await panel.getByRole('button', { name: 'Пятница', exact: true }).click();
  await panel.getByText('Дополнительно', { exact: true }).click();
  await panel.getByLabel('Возраст от — необязательно').fill('4');
  await panel.getByLabel('Возраст до — необязательно').fill('6');
  await panel.getByRole('button', { name: 'Проверить расписание' }).click();
  await expect(panel.getByLabel('Предпросмотр серии')).toContainText('Добавится: 12');
  expect((await list(request, '/api/v1/admin/schedule-groups')).length).toBe(beforeGroups.length);
  expect((await list(request, '/api/v1/admin/session-series')).length).toBe(beforeSeries.length);
  await panel.getByRole('button', { name: 'Следующие даты' }).click();
  await expect(panel.getByLabel('Страницы плана')).toContainText('11–12 из 12');
  await panel.getByRole('button', { name: 'Вид карточки' }).click();
  await expect(panel.getByLabel('Предпросмотр серии')).toContainText('Отправка заявки недоступна');
  await panel.getByRole('button', { name: 'Назад к параметрам' }).click();
  await expect(panel.getByLabel('Название', { exact: true })).toHaveValue(title);
  await expect(panel.getByRole('button', { name: 'Среда', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await panel.getByRole('button', { name: 'Проверить расписание' }).click();
  await panel.getByRole('button', { name: 'Опубликовать расписание' }).click();
  await expect(panel.getByRole('status')).toContainText('Расписание опубликовано');
  const groups = await list(request, '/api/v1/admin/schedule-groups');
  const group = groups.find(
    (item: { parameters: { name: string } }) => item.parameters.name === title,
  );
  expect(group.parameters).toMatchObject({ name: title, capacity: 6, ageFrom: 4, ageTo: 6 });
  const allSeries = await list(request, '/api/v1/admin/session-series');
  const series = allSeries.find((item: { groupId: string }) => item.groupId === group.id);
  expect(series.rule).toMatchObject({
    title,
    durationMinutes: 53,
    weekdays: [1, 3, 5],
    startDate: date,
    endDate: plus(date, 25),
  });
  const from = new Date(date + 'T00:00:00+03:00').toISOString(),
    to = new Date(plus(date, 28) + 'T00:00:00+03:00').toISOString();
  const published = await (
    await request.get(base + '/api/v1/sessions', { params: { from, to, size: 100 } })
  ).json();
  expect(published.items.filter((item: { title: string }) => item.title === title)).toHaveLength(
    12,
  );
  await expect(panel.getByLabel('Название', { exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Изменить расписание' }).click();
  const edit = page.getByRole('dialog');
  await edit.getByRole('button', { name: 'Ср', exact: true }).click();
  await edit.getByRole('button', { name: 'Проверить расписание', exact: true }).click();
  await expect(edit.getByLabel('Причина отмены дат')).toBeVisible();
});

test('existing group is selected explicitly and the saved draft can be reopened', async ({
  page,
  request,
}) => {
  const date = monday(1);
  const group = await command(request, '/api/v1/admin/schedule-groups', {
    expectedVersion: 0,
    parameters: {
      name: 'Существующая ' + test.info().project.name,
      capacity: 8,
      ageFrom: null,
      ageTo: null,
    },
  });
  const before = await list(request, '/api/v1/admin/schedule-groups');
  const title = 'Другая подпись ' + test.info().project.name + ' ' + run;
  const panel = await startWeekly(page, date, title);
  await expect(panel.getByRole('combobox', { name: 'Группа', exact: true })).toHaveValue('');
  await panel.getByRole('combobox', { name: 'Группа', exact: true }).selectOption(group.id);
  await panel.getByRole('button', { name: 'Среда', exact: true }).click();
  await panel.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Черновик серии сохранён');
  expect((await list(request, '/api/v1/admin/schedule-groups')).length).toBe(before.length);
  const series = (await list(request, '/api/v1/admin/session-series')).find(
    (item: { groupId: string }) => item.groupId === group.id,
  );
  expect(series.draft.rule).toMatchObject({ title, weekdays: [1, 3] });
  await panel.getByRole('button', { name: 'Закрыть панель' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Группы', exact: true }).click();
  const groupsPanel = page.getByRole('dialog');
  await groupsPanel.getByRole('combobox', { name: 'Группа', exact: true }).selectOption(group.id);
  await groupsPanel.getByRole('button', { name: 'Открыть расписание', exact: true }).click();
  await expect(groupsPanel.getByLabel('Название занятия')).toHaveValue(title);
  await expect(groupsPanel.getByRole('button', { name: 'Ср', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.route(`**/api/v1/admin/session-series/${series.id}/preview`, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.items[0].conflict = 'Укажите будущее время начала занятия по Москве.';
    data.items[0].conflictCodes = ['FIELD_SESSION_START', 'SCHEDULE_CONFLICT'];
    data.canPublish = false;
    await route.fulfill({ response, json: data });
  });
  await groupsPanel.getByRole('button', { name: 'Проверить расписание', exact: true }).click();
  await expect(groupsPanel.getByLabel('Предпросмотр серии')).toContainText(
    'Начало занятия уже наступило',
  );
  await expect(groupsPanel.getByLabel('Предпросмотр серии')).toContainText(
    'Это время уже занято другим занятием',
  );
  await expect(groupsPanel.getByRole('button', { name: 'Опубликовать расписание' })).toBeDisabled();
});

test('discard protection, repeat toggle and focus geometry preserve the same dialog', async ({
  page,
}) => {
  const panel = await startWeekly(page, monday(2), 'Проверка ввода');
  await panel.getByRole('button', { name: 'Среда', exact: true }).click();
  await panel.getByRole('button', { name: 'Не повторять', exact: true }).click();
  await panel.getByRole('button', { name: 'Еженедельно · выбрать дни' }).click();
  await expect(panel.getByRole('button', { name: 'Среда', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const title = panel.getByLabel('Название', { exact: true });
  await title.focus();
  const geometry = await title.evaluate((el) => {
    const field = el.getBoundingClientRect(),
      scroller = el.closest('.editor-scroll')!.getBoundingClientRect(),
      style = getComputedStyle(el);
    const close = el
        .closest('dialog')!
        .querySelector('.panel-heading button')!
        .getBoundingClientRect(),
      glyph = el
        .closest('dialog')!
        .querySelector('.panel-heading button span')!
        .getBoundingClientRect();
    return {
      left: field.left - scroller.left,
      right: scroller.right - field.right,
      need: parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset),
      closeX: Math.abs((close.left + close.right - glyph.left - glyph.right) / 2),
      closeY: Math.abs((close.top + close.bottom - glyph.top - glyph.bottom) / 2),
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.need);
  expect(geometry.right).toBeGreaterThanOrEqual(geometry.need);
  expect(geometry.closeX).toBeLessThan(1.5);
  expect(geometry.closeY).toBeLessThan(1.5);
  await panel.screenshot({ path: test.info().outputPath('weekly-form.png') });
  await panel.getByRole('button', { name: 'Закрыть панель' }).click();
  const confirm = page.getByRole('dialog', { name: 'Выйти без сохранения?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Остаться' }).click();
  await expect(title).toHaveValue('Проверка ввода');
  await expect(panel.getByRole('button', { name: 'Среда', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
  await page
    .getByRole('dialog', { name: 'Выйти без сохранения?' })
    .getByRole('button', { name: 'Выйти', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('lost response can be safely recovered without creating another group', async ({
  page,
  request,
}) => {
  const title = 'Неопределённый результат ' + test.info().project.name + ' ' + run;
  const panel = await startWeekly(page, monday(3), title);
  await page.route(
    '**/api/v1/admin/session-series/new-group',
    async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          status: 503,
          code: 'SERVICE_UNAVAILABLE',
          detail: 'Ответ потерян',
          fieldErrors: {},
        }),
      });
    },
    { times: 1 },
  );
  await panel.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(
    panel.getByText('Результат сохранения пока неизвестен.', { exact: false }),
  ).toBeVisible();
  await panel.getByRole('button', { name: 'Закрыть панель' }).click();
  await page
    .getByRole('dialog', { name: 'Закрыть окно?' })
    .getByRole('button', { name: 'Закрыть окно', exact: true })
    .click();
  await page.getByRole('button', { name: 'Уточнить результат' }).click();
  await expect(page.getByLabel('Состояние сохранения')).toHaveCount(0);
  const groups = (await list(request, '/api/v1/admin/schedule-groups')).filter(
    (item: { parameters: { name: string } }) => item.parameters.name === title,
  );
  expect(groups).toHaveLength(1);
  const series = (await list(request, '/api/v1/admin/session-series')).filter(
    (item: { groupId: string }) => item.groupId === groups[0].id,
  );
  expect(series).toHaveLength(1);
});

test('immediate typing and paste keep the first character through repeat changes', async ({
  page,
}) => {
  await openNew(page, monday(4));
  await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(page.getByText('Название: Заполните это поле.')).toBeVisible();
  for (let attempt = 0; attempt < 6; attempt++) {
    const panel = page.getByRole('dialog', { name: 'Новое занятие', exact: true });
    const title = panel.getByLabel('Название', { exact: true });
    if (attempt % 2 === 0) await title.fill('Малышарики');
    else await title.pressSequentially('Малышарики');
    await expect(page.getByText('Название: Заполните это поле.')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Еженедельно · выбрать дни' }).click();
    await expect(title).toHaveValue('Малышарики');
    await panel.getByRole('button', { name: 'Закрыть панель' }).click();
    await page
      .getByRole('dialog', { name: 'Выйти без сохранения?' })
      .getByRole('button', { name: 'Выйти', exact: true })
      .click();
    if (attempt < 5)
      await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
  }
});

test('a conflicting date blocks publication without creating a group', async ({
  page,
  request,
}) => {
  const date = monday(5);
  const start = new Date(date + 'T17:00:00+03:00').toISOString();
  const end = new Date(date + 'T18:00:00+03:00').toISOString();
  const busy = await command(request, '/api/v1/admin/sessions', {
    title: 'Занятое время ' + test.info().project.name + ' ' + run,
    format: 'GROUP',
    startsAt: start,
    endsAt: end,
    capacity: 8,
  });
  await command(request, `/api/v1/admin/sessions/${busy.id}/actions`, {
    expectedVersion: busy.version,
    action: 'PUBLISH',
  });
  const before = await list(request, '/api/v1/admin/schedule-groups');
  const panel = await startWeekly(page, date, 'Конфликт ' + test.info().project.name);
  await panel.getByRole('button', { name: 'Проверить расписание' }).click();
  await expect(panel.getByLabel('Предпросмотр серии')).toContainText('конфликт');
  await expect(panel.getByRole('button', { name: 'Опубликовать расписание' })).toBeDisabled();
  expect((await list(request, '/api/v1/admin/schedule-groups')).length).toBe(before.length);
});

test('field focus outlines remain visible across narrow, wide and enlarged layouts', async ({
  page,
}) => {
  for (const [width, height, scale] of [
    [320, 900, 1],
    [375, 900, 1],
    [768, 900, 1],
    [1440, 900, 1],
    [375, 900, 2],
    [320, 400, 1],
  ]) {
    await page.setViewportSize({ width, height });
    const panel = await startWeekly(page, monday(6), 'Проверка фокуса');
    await page.evaluate((factor) => {
      document.documentElement.style.fontSize = `${factor * 100}%`;
    }, scale);
    await panel.getByText('Дополнительно', { exact: true }).click();
    for (const name of [
      'Название',
      'Формат',
      'Дата занятия · МСК',
      'Начало · МСК',
      'Длительность, минут',
      'Размер группы',
      'Группа',
      'Последняя дата повторения · МСК',
      'Возраст от — необязательно',
      'Возраст до — необязательно',
    ]) {
      const field =
        name === 'Группа' || name === 'Формат'
          ? panel.getByRole('combobox', { name, exact: true })
          : panel.getByLabel(name, { exact: true });
      await field.focus();
      await expect
        .poll(
          () =>
            field.evaluate((element) => {
              const box = element.getBoundingClientRect(),
                scroller = element.closest('.editor-scroll')!.getBoundingClientRect(),
                body = element.closest('.panel-body')!.getBoundingClientRect(),
                style = getComputedStyle(element);
              const need = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
              return (
                Math.min(
                  box.left - Math.max(scroller.left, body.left),
                  Math.min(scroller.right, body.right) - box.right,
                  box.top - Math.max(scroller.top, body.top),
                  Math.min(scroller.bottom, body.bottom) - box.bottom,
                ) - need
              );
            }),
          { message: `${name}, ${width}×${height}px, ${scale * 100}%`, timeout: 3000 },
        )
        .toBeGreaterThanOrEqual(-0.5);
    }
    await panel.getByRole('button', { name: 'Закрыть панель' }).click();
    await page
      .getByRole('dialog', { name: 'Выйти без сохранения?' })
      .getByRole('button', { name: 'Выйти', exact: true })
      .click();
  }
});
