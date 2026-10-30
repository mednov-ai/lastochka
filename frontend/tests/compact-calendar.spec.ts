import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const base = 'http://localhost:18100/lastochka';
const out = new URL('../../artifacts/compact-calendar/screenshots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
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
const plus = (d: string, n: number) =>
  new Date(Date.parse(d + 'T12:00:00+03:00') + n * 86400000).toISOString().slice(0, 10);
function date(n = 0) {
  const d = new Date(
    Date.UTC(
      2050,
      0,
      3 +
        projects.indexOf(test.info().project.name) * 5000 +
        n * 400 +
        Number(process.env.COMPACT_RUN_OFFSET ?? 0),
    ),
  );
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}
const iso = (d: string, t = '00:00') => new Date(d + 'T' + t + ':00+03:00').toISOString();
async function cmd(
  r: APIRequestContext,
  path: string,
  data: unknown,
  method: 'post' | 'put' = 'post',
) {
  const csrf = await (await r.get(base + '/api/v1/auth/csrf')).json();
  const res = await r[method](base + path, {
    headers: {
      [csrf.headerName]: csrf.token,
      'Idempotency-Key': crypto.randomUUID(),
      Origin: 'http://localhost:18100',
    },
    data,
  });
  expect(res.ok(), path + ' ' + (await res.text())).toBe(true);
  return res.json();
}
async function open(p: Page, d = date()) {
  await p.goto(base + '/admin/schedule');
  await p.getByLabel('Дата', { exact: true }).fill(d);
  await expect(p.getByRole('button', { name: 'Группы', exact: true })).toBeVisible();
  await expect(p.getByText('Загрузка…', { exact: true })).toHaveCount(0);
}
async function close(p: Page) {
  await p.getByRole('button', { name: 'Закрыть панель', exact: true }).click();
  const exit = p.getByRole('dialog', { name: 'Выйти без сохранения?', exact: true });
  if (await exit.isVisible())
    await exit.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(p.getByRole('dialog')).toHaveCount(0);
}
async function group(r: APIRequestContext, name: string) {
  return cmd(r, '/api/v1/admin/schedule-groups', {
    expectedVersion: 0,
    parameters: { name, capacity: 8, ageFrom: 3, ageTo: 7 },
  });
}
async function series(p: Page, gid: string, d: string) {
  await open(p, d);
  await p.getByRole('button', { name: 'Группы', exact: true }).click();
  await p.getByRole('combobox', { name: 'Группа', exact: true }).selectOption(gid);
  await p.getByRole('button', { name: 'Создать расписание группы', exact: true }).click();
  await expect(p.getByRole('button', { name: 'Проверить расписание', exact: true })).toBeEnabled();
}
async function rectangle(p: Page) {
  return p.locator('.calendar-dialog').evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
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
  await cmd(request, '/api/v1/auth/password-stage', {
    login: 'recurring-admin',
    password: 'Fixture-pass-123',
  });
  await context.addCookies((await request.storageState()).cookies);
});

test('clean close, dirty close, top-layer Escape and exact duration controls', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
  const duration = page.getByLabel('Длительность, минут', { exact: true });
  await expect(duration).toHaveValue('60');
  await page.getByRole('button', { name: 'Увеличить на 30 минут' }).click();
  await expect(duration).toHaveValue('90');
  await duration.press('ArrowDown');
  await expect(duration).toHaveValue('60');
  await page.getByRole('button', { name: 'Уменьшить на 30 минут' }).click();
  await expect(duration).toHaveValue('30');
  await expect(page.getByRole('button', { name: 'Уменьшить на 30 минут' })).toBeDisabled();
  await duration.fill('53');
  await duration.press('ArrowUp');
  await expect(duration).toHaveValue('83');
  await duration.fill('53');
  await page.getByLabel('Начало · МСК', { exact: true }).fill('23:30');
  await duration.fill('90');
  await expect(page.locator('.editor-messages')).toContainText('01:00 МСК');
  await page.getByLabel('Начало · МСК', { exact: true }).fill('17:00');
  await duration.fill('53');
  await page.getByLabel('Название', { exact: true }).fill('Незавершённый ввод');
  const before = await rectangle(page);
  await page.getByRole('button', { name: 'Закрыть панель' }).click();
  const exit = page.getByRole('dialog', { name: 'Выйти без сохранения?', exact: true });
  await expect(exit).toBeVisible();
  expect(await rectangle(page)).toEqual(before);
  await expect(exit.getByRole('button', { name: 'Остаться', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(exit).toHaveCount(0);
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Незавершённый ввод');
  await page.keyboard.press('Escape');
  await expect(exit).toBeVisible();
  await exit.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Создать занятие', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('weekly selection stays in the new session and preserves entered values', async ({
  page,
  request,
}) => {
  await page.route('**/api/v1/admin/schedule-groups', async (route) => {
    if (route.request().method() === 'GET') await route.fulfill({ json: { items: [] } });
    else await route.continue();
  });
  await open(page);
  await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
  await page.getByLabel('Название', { exact: true }).pressSequentially('Малышарики', { delay: 5 });
  await page.getByRole('button', { name: 'Еженедельно · выбрать дни' }).click();
  await expect(page.getByRole('dialog', { name: 'Новое занятие' })).toBeVisible();
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Малышарики');
  await expect(page.getByLabel('Название группы', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Дни повторения' })).toBeVisible();
  await page.getByRole('button', { name: 'Среда', exact: true }).click();
  await page.getByRole('button', { name: 'Не повторять', exact: true }).click();
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Малышарики');
  await page.getByRole('button', { name: 'Еженедельно · выбрать дни' }).click();
  await expect(page.getByRole('button', { name: 'Среда', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('Escape');
  await page
    .getByRole('dialog', { name: 'Выйти без сохранения?', exact: true })
    .getByRole('button', { name: 'Выйти', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.unroute('**/api/v1/admin/schedule-groups');
  await group(request, 'Выбор группы ' + test.info().project.name + ' ' + date());
  await open(page);
  await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
  await page.getByRole('button', { name: 'Еженедельно · выбрать дни' }).click();
  await expect(page.getByRole('combobox', { name: 'Группа', exact: true })).toHaveValue('');
  await expect(page.getByRole('group', { name: 'Дни повторения' })).toBeVisible();
  await close(page);
});

test('save without manual preview, publish twelve dates, remove Wednesday and keep IDs', async ({
  page,
  request,
}) => {
  const d = date(1),
    g = await group(request, 'Серия ' + test.info().project.name + ' ' + d);
  await series(page, g.id, d);
  await page.getByLabel('Последняя дата', { exact: true }).fill(plus(d, 25));
  for (const day of ['Ср', 'Пт'])
    await page.getByRole('button', { name: day, exact: true }).click();
  let previews = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/preview')) previews++;
  });
  await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(page.locator('.calendar-dialog').getByRole('status')).toContainText(
    'Черновик серии сохранён',
  );
  expect(previews).toBe(0);
  const saved = (
    await (await request.get(base + '/api/v1/admin/session-series')).json()
  ).items.find((s: { groupId: string }) => s.groupId === g.id);
  expect(saved.draft.rule.ageFrom).toBe(3);
  const params = { from: iso(d), to: iso(plus(d, 28)), size: 100 };
  expect((await (await request.get(base + '/api/v1/sessions', { params })).json()).total).toBe(0);
  await close(page);
  await page.getByRole('button', { name: 'Группы', exact: true }).click();
  await page.getByRole('combobox', { name: 'Группа', exact: true }).selectOption(g.id);
  await page.getByRole('button', { name: 'Открыть расписание', exact: true }).click();
  await expect(page.getByLabel('Длительность, минут', { exact: true })).toHaveValue('60');
  await page.getByRole('button', { name: 'Проверить расписание', exact: true }).click();
  await expect(page.getByLabel('Предпросмотр серии')).toContainText('Добавится: 12');
  await page.getByRole('button', { name: 'Следующие даты', exact: true }).click();
  await expect(page.getByLabel('Страницы плана')).toContainText('11–12 из 12');
  await page.getByRole('button', { name: 'Вид карточки', exact: true }).click();
  await expect(page.getByLabel('Предпросмотр серии')).toContainText('Отправка заявки недоступна');
  await page.getByRole('button', { name: 'Даты плана', exact: true }).click();
  await page.getByRole('button', { name: 'Опубликовать расписание', exact: true }).click();
  await expect(page.locator('.calendar-dialog').getByRole('status')).toContainText(
    'Расписание опубликовано',
  );
  const before = await (await request.get(base + '/api/v1/sessions', { params })).json();
  expect(before.total).toBe(12);
  await page.getByRole('button', { name: 'Параметры', exact: true }).click();
  await page.getByRole('button', { name: 'Ср', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить расписание', exact: true }).click();
  await expect(page.getByLabel('Причина отмены дат', { exact: true })).toBeVisible();
  await page.getByLabel('Причина отмены дат', { exact: true }).fill('Проверочная отмена');
  await page.getByRole('button', { name: 'Проверить снова', exact: true }).click();
  await page.getByRole('button', { name: 'Опубликовать расписание', exact: true }).click();
  await expect(page.locator('.calendar-dialog').getByRole('status')).toContainText(
    'Расписание опубликовано',
  );
  const after = await (await request.get(base + '/api/v1/sessions', { params })).json();
  expect(after.total).toBe(8);
  expect(
    after.items.every((s: { id: string }) =>
      before.items.some((v: { id: string }) => v.id === s.id),
    ),
  ).toBe(true);
});

test('laptop layout fits and dialog stays still across states and text scaling', async ({
  page,
  request,
}) => {
  const g = await group(request, 'Геометрия ' + test.info().project.name + ' ' + date(2));
  await open(page, date(2));
  await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1522, 1230],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.locator('.editor-scroll').evaluate((e) => e.scrollHeight - e.clientHeight),
    ).toBeLessThanOrEqual(1);
  }
  await close(page);
  await series(page, g.id, date(2));
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1522, 1230],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.locator('.editor-scroll').evaluate((e) => e.scrollHeight - e.clientHeight),
    ).toBeLessThanOrEqual(1);
  }
  await page.getByLabel('Название занятия', { exact: true }).fill('Изменённое название');
  const before = await rectangle(page);
  await page.keyboard.press('Escape');
  expect(await rectangle(page)).toEqual(before);
  await page.getByRole('button', { name: 'Остаться', exact: true }).click();
  for (const [width, height] of [
    [320, 568],
    [375, 667],
    [768, 1024],
    [1024, 768],
  ]) {
    await page.setViewportSize({ width, height });
    for (const enlarged of [false, true]) {
      await page.evaluate(
        (v) => (document.documentElement.style.fontSize = v ? '200%' : ''),
        enlarged,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      const footer = await page.locator('.editor-command-bar').boundingBox();
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(height);
      await expect(page.getByRole('button', { name: 'Закрыть панель' })).toBeVisible();
    }
  }
  await page.evaluate(() => (document.documentElement.style.fontSize = ''));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .locator('.calendar-dialog')
    .screenshot({ path: out + test.info().project.name + '-parameters.png' });
});

test('grid gestures and exact existing 53 minutes keep their values', async ({
  page,
  request,
}, info) => {
  const d = date(3),
    s = await cmd(request, '/api/v1/admin/sessions', {
      title: 'Точные минуты ' + info.project.name,
      format: 'GROUP',
      startsAt: iso(d, '18:07'),
      endsAt: iso(d, '19:00'),
      capacity: 8,
    });
  await open(page, d);
  if (info.project.use.viewport!.width < 960) {
    await page.getByRole('button', { name: 'Открыть занятие', exact: true }).first().click();
  } else await page.locator(`[data-session-id="${s.id}"] .calendar-event-body`).click();
  await expect(page.getByLabel('Начало · МСК', { exact: true })).toHaveValue('18:07');
  await expect(page.getByLabel('Длительность, минут', { exact: true })).toHaveValue('53');
  await close(page);
  if (info.project.use.viewport!.width >= 960) {
    const calendar = page.locator('.calendar-desktop');
    await calendar.scrollIntoViewIfNeeded();
    await calendar.evaluate((e) => (e.scrollTop = 180));
    let rect = (await page.locator('.time-day').first().boundingBox())!;
    await page.mouse.click(rect.x + 25, rect.y + 360);
    await expect(page.getByLabel('Длительность, минут', { exact: true })).toHaveValue('60');
    await close(page);
    rect = (await page.locator('.time-day').first().boundingBox())!;
    await page.mouse.move(rect.x + 25, rect.y + 360);
    await page.mouse.down();
    await page.mouse.move(rect.x + 25, rect.y + 405, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByLabel('Длительность, минут', { exact: true })).toHaveValue('45');
    await close(page);
  }
});

test('unknown group save survives close and reload and repeats the same command', async ({
  page,
  request,
}) => {
  const name = 'Неизвестный исход ' + test.info().project.name + ' ' + date(4),
    keys: string[] = [],
    bodies: string[] = [];
  let first = true;
  await page.route('**/api/v1/admin/schedule-groups', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    keys.push(route.request().headers()['idempotency-key']);
    bodies.push(route.request().postData()!);
    if (!first) {
      await route.continue();
      return;
    }
    first = false;
    await route.fetch();
    await new Promise((r) => setTimeout(r, 11000));
    await route.fulfill({
      status: 503,
      json: {
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        detail: 'Ответ не получен',
        fieldErrors: {},
      },
    });
  });
  await open(page, date(4));
  await page.getByRole('button', { name: 'Группы', exact: true }).click();
  await page.getByRole('button', { name: 'Новая группа', exact: true }).click();
  await page.getByLabel('Название группы', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Сохранить группу', exact: true }).click();
  await expect.poll(() => keys.length).toBe(1);
  await page.getByRole('button', { name: 'Закрыть панель' }).click();
  await page
    .getByRole('dialog', { name: 'Закрыть окно?', exact: true })
    .getByRole('button', { name: 'Закрыть окно', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Состояние сохранения')).toContainText('Результат пока неизвестен', {
    timeout: 12000,
  });
  await page.waitForTimeout(1300);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Состояние сохранения')).toContainText('Результат пока неизвестен');
  await page.getByRole('button', { name: 'Уточнить результат', exact: true }).click();
  await expect(page.getByLabel('Состояние сохранения')).toHaveCount(0);
  expect(keys.length).toBe(2);
  expect(new Set(keys).size).toBe(1);
  expect(new Set(bodies).size).toBe(1);
  const groups = await (await request.get(base + '/api/v1/admin/schedule-groups')).json();
  expect(
    groups.items.filter((g: { parameters: { name: string } }) => g.parameters.name === name),
  ).toHaveLength(1);
});

test('all 200 dates, last conflict, lost publication reply and individual drafts remain safe', async ({
  page,
  request,
}, info) => {
  const d = date(6),
    g = await group(request, 'Полный план ' + info.project.name + ' ' + d),
    rule = {
      title: g.parameters.name,
      startDate: d,
      endDate: plus(d, 199),
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      startTime: '20:00',
      durationMinutes: 60,
      capacity: 8,
    };
  const saved = await cmd(request, '/api/v1/admin/session-series', {
    groupId: g.id,
    expectedVersion: 0,
    rule,
    cancelFollowing: false,
  });
  let blocker = await cmd(request, '/api/v1/admin/sessions', {
    title: 'Конфликт ' + info.project.name,
    format: 'GROUP',
    startsAt: iso(rule.endDate, '20:00'),
    endsAt: iso(rule.endDate, '21:00'),
    capacity: 8,
  });
  blocker = await cmd(request, '/api/v1/admin/sessions/' + blocker.id + '/actions', {
    expectedVersion: blocker.version,
    action: 'PUBLISH',
  });
  await open(page, d);
  await page.getByRole('button', { name: 'Группы', exact: true }).click();
  await page.getByRole('combobox', { name: 'Группа', exact: true }).selectOption(g.id);
  await page.getByRole('button', { name: 'Открыть расписание', exact: true }).click();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/' + saved.id + '/preview') && r.ok(),
  );
  await page.getByRole('button', { name: 'Проверить расписание', exact: true }).click();
  const plan = await (await response).json();
  expect(plan.total).toBe(200);
  expect(plan.canPublish).toBe(false);
  await page.getByRole('button', { name: 'К первому конфликту', exact: true }).click();
  await expect(page.getByLabel('Страницы плана')).toContainText('191–200 из 200');
  await expect(
    page.getByRole('button', { name: 'Опубликовать расписание', exact: true }),
  ).toBeDisabled();
  await page
    .locator('.calendar-dialog')
    .screenshot({ path: out + info.project.name + '-last-conflict.png' });
  const csrf = await (await request.get(base + '/api/v1/auth/csrf')).json();
  const failed = await request.post(
    base + '/api/v1/admin/session-series/' + saved.id + '/publish',
    {
      headers: {
        [csrf.headerName]: csrf.token,
        'Idempotency-Key': crypto.randomUUID(),
        Origin: 'http://localhost:18100',
      },
      data: {
        expectedVersion: saved.version,
        expectedDraftVersion: saved.draftVersion,
        digest: plan.digest,
      },
    },
  );
  expect(failed.status()).toBe(409);
  await cmd(request, '/api/v1/admin/sessions/' + blocker.id + '/actions', {
    expectedVersion: blocker.version,
    action: 'CANCEL',
    reason: 'Проверочная занятость снята',
  });
  await page.getByRole('button', { name: 'Параметры', exact: true }).click();
  await page.getByRole('button', { name: 'Проверить расписание', exact: true }).click();
  const keys: string[] = [];
  let first = true;
  await page.route('**/api/v1/admin/session-series/' + saved.id + '/publish', async (route) => {
    keys.push(route.request().headers()['idempotency-key']);
    if (!first) {
      await route.continue();
      return;
    }
    first = false;
    await route.fetch();
    await route.fulfill({
      status: 503,
      json: {
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        detail: 'Ответ не получен',
        fieldErrors: {},
      },
    });
  });
  await page.getByRole('button', { name: 'Опубликовать расписание', exact: true }).click();
  await expect(page.getByLabel('Состояние сохранения')).toContainText('Результат пока неизвестен');
  await page.getByRole('button', { name: 'Закрыть панель' }).click();
  await page
    .getByRole('dialog', { name: 'Закрыть окно?', exact: true })
    .getByRole('button', { name: 'Закрыть окно', exact: true })
    .click();
  await page.getByRole('button', { name: 'Уточнить результат', exact: true }).click();
  await expect(page.getByLabel('Состояние сохранения')).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(new Set(keys).size).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const sessions: {
    id: string;
    version: number;
    title: string;
    startsAt: string;
    endsAt: string;
    capacity: number;
    format: string;
  }[] = [];
  for (let i = 0; i < 200; i += 90) {
    const list = await (
      await request.get(base + '/api/v1/sessions', {
        params: { from: iso(plus(d, i)), to: iso(plus(d, Math.min(200, i + 90))), size: 100 },
      })
    ).json();
    sessions.push(...list.items);
  }
  expect(sessions).toHaveLength(200);
  expect(new Set(sessions.map((s) => s.id)).size).toBe(200);
  const firstSession = sessions[0],
    second = sessions[1];
  await cmd(
    request,
    '/api/v1/admin/sessions/' + firstSession.id,
    {
      expectedVersion: firstSession.version,
      session: {
        title: firstSession.title,
        format: firstSession.format,
        capacity: 8,
        startsAt: new Date(Date.parse(firstSession.startsAt) + 15 * 60000).toISOString(),
        endsAt: new Date(Date.parse(firstSession.endsAt) + 15 * 60000).toISOString(),
      },
    },
    'put',
  );
  const current = await (
    await request.get(base + '/api/v1/admin/session-series/' + saved.id)
  ).json();
  const input = {
    groupId: g.id,
    expectedVersion: current.version,
    rule: { ...rule, startTime: '21:30' },
    cancelFollowing: false,
  };
  const edit = await cmd(
    request,
    '/api/v1/admin/session-series/' + saved.id + '/draft',
    input,
    'put',
  );
  const next = await cmd(request, '/api/v1/admin/session-series/' + saved.id + '/preview', {
    ...input,
    expectedDraftVersion: edit.draftVersion,
  });
  expect(
    next.items.find((r: { sessionId: string }) => r.sessionId === firstSession.id).exception,
  ).toBe(true);
  await cmd(
    request,
    '/api/v1/admin/sessions/' + second.id + '/draft',
    {
      expectedSessionVersion: second.version,
      expectedDraftVersion: null,
      session: {
        title: second.title + ' правка',
        format: 'GROUP',
        capacity: 8,
        startsAt: second.startsAt,
        endsAt: second.endsAt,
      },
    },
    'put',
  );
  const csrf2 = await (await request.get(base + '/api/v1/auth/csrf')).json();
  const stale = await request.post(base + '/api/v1/admin/session-series/' + saved.id + '/publish', {
    headers: {
      [csrf2.headerName]: csrf2.token,
      'Idempotency-Key': crypto.randomUUID(),
      Origin: 'http://localhost:18100',
    },
    data: {
      expectedVersion: edit.version,
      expectedDraftVersion: edit.draftVersion,
      digest: next.digest,
    },
  });
  expect(stale.status()).toBe(409);
  const draft = await (
    await request.get(base + '/api/v1/admin/sessions/' + second.id + '/draft')
  ).json();
  expect(draft.draft.session.title).toContain('правка');
  expect(
    (await (await request.get(base + '/api/v1/admin/session-series/' + saved.id)).json()).draft,
  ).toBeTruthy();
});

test('late reads do not reopen dialogs and closing during CSRF never sends a write', async ({
  page,
}) => {
  await open(page, date(8));
  let delay = false;
  await page.route('**/api/v1/admin/session-series', async (route) => {
    if (delay && route.request().method() === 'GET') {
      await new Promise((r) => setTimeout(r, 1500));
    }
    await route.continue();
  });
  delay = true;
  await page.getByRole('button', { name: 'Группы', exact: true }).click();
  await page.getByRole('button', { name: 'Закрыть панель', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.waitForTimeout(1800);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.unroute('**/api/v1/admin/session-series');
  await page.getByRole('button', { name: 'Группы', exact: true }).click();
  await page.getByRole('button', { name: 'Новая группа', exact: true }).click();
  await page.getByLabel('Название группы', { exact: true }).fill('Не отправлять после закрытия');
  let writes = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/schedule-groups')) writes++;
  });
  await page.route('**/api/v1/auth/csrf', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  const csrf = page.waitForRequest((r) => r.url().endsWith('/auth/csrf'));
  await page.getByRole('button', { name: 'Сохранить группу', exact: true }).click();
  await csrf;
  await page.getByRole('button', { name: 'Закрыть панель' }).click();
  await page
    .getByRole('dialog', { name: 'Выйти без сохранения?', exact: true })
    .getByRole('button', { name: 'Выйти', exact: true })
    .click();
  await page.waitForTimeout(1800);
  expect(writes).toBe(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('recovery belongs to one ADMIN, expires safely and is cleared at logout', async ({
  page,
  request,
}) => {
  const auth = await (await request.get(base + '/api/v1/auth/me')).json();
  await open(page, date(9));
  const key = 'lastochka-calendar-commands-v1';
  const record = {
    key: crypto.randomUUID(),
    actor: auth.account.id,
    url: '/lastochka/api/v1/admin/schedule-groups',
    method: 'POST',
    resource: '/lastochka/api/v1/admin/schedule-groups',
    body: JSON.stringify({
      expectedVersion: 0,
      parameters: { name: 'Проверка контекста', capacity: 8 },
    }),
    started: Date.now(),
    status: 'unknown',
  };
  await page.evaluate(
    ([key, record]) => sessionStorage.setItem(String(key), JSON.stringify([record])),
    [key, record],
  );
  await page.reload();
  await expect(page.getByLabel('Состояние сохранения')).toBeVisible();
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ json: { ...auth, account: { ...auth.account, id: crypto.randomUUID() } } }),
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Группы', exact: true })).toBeVisible();
  await expect(page.getByLabel('Состояние сохранения')).toHaveCount(0);
  expect(await page.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull();
  await page.unroute('**/api/v1/auth/me');
  await page.reload();
  await page.evaluate(
    ([key, record]) => sessionStorage.setItem(String(key), JSON.stringify([record])),
    [key, { ...record, started: Date.now() - 86401000 }],
  );
  await page.reload();
  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/schedule-groups')) posts++;
  });
  await page.getByRole('button', { name: 'Уточнить результат', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Срок безопасного повтора истёк');
  expect(posts).toBe(0);
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Подтвердить сверку данных', exact: true }).click();
  await expect(page.getByLabel('Состояние сохранения')).toHaveCount(0);
  expect(posts).toBe(0);
  await page.evaluate(
    ([key, record]) => sessionStorage.setItem(String(key), JSON.stringify([record])),
    [key, record],
  );
  await page.reload();
  await expect(page.getByLabel('Состояние сохранения')).toBeVisible();
  await page.evaluate(async () => {
    const c = await (await fetch('/lastochka/api/v1/auth/csrf')).json();
    await fetch('/lastochka/api/v1/auth/logout', {
      method: 'POST',
      headers: { [c.headerName]: c.token },
    });
    window.dispatchEvent(new Event('lastochka:auth-changed'));
  });
  await expect.poll(() => page.evaluate((k) => sessionStorage.getItem(k), key)).toBeNull();
});

test('single-session draft publication history restoration and cancellation keep the public version', async ({
  page,
  request,
}, info) => {
  const d = date(10),
    title = 'Одиночное ' + info.project.name + ' ' + d;
  await open(page, d);
  await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
  const panel = page.locator('.calendar-dialog');
  await page.getByLabel('Название', { exact: true }).fill(title);
  await page.getByLabel('Формат', { exact: true }).selectOption('INDIVIDUAL');
  await expect(page.getByLabel('Размер группы', { exact: true })).toHaveCount(0);
  await page.getByLabel('Формат', { exact: true }).selectOption('GROUP');
  await expect(page.getByLabel('Размер группы', { exact: true })).toHaveValue('8');
  await page.getByText('Дополнительно', { exact: true }).click();
  await page.getByLabel('Возраст от — необязательно', { exact: true }).fill('3');
  await page.getByLabel('Возраст до — необязательно', { exact: true }).fill('7');
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/admin/sessions') && r.ok(),
  );
  await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  const saved = await (await created).json();
  await expect(panel.getByRole('status')).toContainText('Черновик сохранён');
  expect((await request.get(base + '/api/v1/sessions/' + saved.id)).ok()).toBe(false);
  await page.getByRole('button', { name: 'Проверить изменения', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить публикацию', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('опубликовано');
  expect((await (await request.get(base + '/api/v1/sessions/' + saved.id)).json()).title).toBe(
    title,
  );
  await page.getByRole('button', { name: 'Параметры', exact: true }).click();
  await page.getByLabel('Название', { exact: true }).fill(title + ' правка');
  await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('прежние условия');
  expect((await (await request.get(base + '/api/v1/sessions/' + saved.id)).json()).title).toBe(
    title,
  );
  await close(page);
  if (info.project.use.viewport!.width < 960)
    await page.getByRole('button', { name: 'Открыть занятие', exact: true }).first().click();
  else await page.locator(`[data-session-id="${saved.id}"] .calendar-event-body`).click();
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue(title + ' правка');
  await page.getByRole('button', { name: 'Проверить изменения', exact: true }).click();
  await page.getByRole('button', { name: 'Подтвердить публикацию', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Изменения опубликованы');
  expect((await (await request.get(base + '/api/v1/sessions/' + saved.id)).json()).title).toBe(
    title + ' правка',
  );
  await page.getByRole('button', { name: 'Параметры', exact: true }).click();
  await page.getByRole('button', { name: 'История изменений', exact: true }).click();
  await page.getByRole('button', { name: 'Восстановить в черновик', exact: true }).last().click();
  await expect(panel.getByRole('status')).toContainText('Прежние параметры');
  await page.getByRole('button', { name: 'Назад к параметрам', exact: true }).click();
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue(title);
  expect((await (await request.get(base + '/api/v1/sessions/' + saved.id)).json()).title).toBe(
    title + ' правка',
  );
  await page.getByText('Отмена занятия', { exact: true }).click();
  await page.getByLabel('Причина отмены', { exact: true }).fill('Приёмочная отмена');
  await page.getByRole('button', { name: 'Подтвердить отмену занятия', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('приёма сохранено');
  expect((await request.get(base + '/api/v1/sessions/' + saved.id)).ok()).toBe(false);
});
