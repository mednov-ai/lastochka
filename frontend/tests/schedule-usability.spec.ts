import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const firstDirection = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const secondDirection = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const thirdDirection = '99999999-9999-4999-8999-999999999999';
const ruleId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const cancelledRule = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const cancelledId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const sessionId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const ageDirections = [
  { id: firstDirection, title: '8–9 лет', description: '', ageFrom: 8, ageTo: 9, ageOpenEnded: false, active: true, sortOrder: 1, version: 0 },
  { id: secondDirection, title: '14+ лет', description: '', ageFrom: 14, ageTo: null, ageOpenEnded: true, active: true, sortOrder: 2, version: 0 },
  { id: thirdDirection, title: '6–7 лет', description: '', ageFrom: 6, ageTo: 7, ageOpenEnded: false, active: true, sortOrder: 3, version: 0 },
];
const calc = (seriesId: string, title: string, ageFrom: number, ageTo: number | null, hour: string) => ({
  kind: 'CALCULATED', calculated: { seriesId, originalDate: '2080-01-01', seriesVersion: 1, title,
    startsAt: `2080-01-01T${hour}:00:00Z`, endsAt: `2080-01-01T${String(Number(hour) + 1).padStart(2, '0')}:00:00Z`,
    capacity: 8, ageFrom, ageTo, ageOpenEnded: ageTo === null },
});
const cancelled = { id: cancelledId, title: 'Отменённое занятие', format: 'GROUP', startsAt: '2080-01-01T16:00:00Z', endsAt: '2080-01-01T17:00:00Z', capacity: 8, ageFrom: 14, ageTo: null, ageOpenEnded: true, status: 'CANCELLED', version: 2, zone: 'Europe/Moscow' };
const materialized = { id: sessionId, title: '8–9 лет', format: 'GROUP', startsAt: '2080-01-01T14:00:00Z', endsAt: '2080-01-01T15:00:00Z', capacity: 8, ageFrom: 8, ageTo: 9, ageOpenEnded: false, status: 'OPEN', version: 1, zone: 'Europe/Moscow' };
const membership = (id: string, seriesId: string) => ({ sessionId: id, seriesId, groupId: firstDirection, groupName: 'Направление', originalDate: '2080-01-01', exception: id === cancelledId, permanent: true });

async function adminFixture(page: Page, readOnly = false) {
  let opened = 0, created = false, failProjection = false;
  await page.route('**/api/v1/**', async (route) => {
    const u = new URL(route.request().url()), path = u.pathname.split('/api/v1')[1];
    let body: unknown = {};
    if (path === '/auth/me') body = { state: 'FULL', account: readOnly ? { id: 'staff', login: 'staff', name: 'Сотрудник', role: 'STAFF', permissions: ['SCHEDULE_VIEW'] } : { id: 'admin', login: 'admin', name: 'Администратор', role: 'ADMIN', roles: ['ADMIN'] } };
    else if (path === '/auth/csrf') body = { token: 'fixture', headerName: 'X-CSRF-TOKEN', parameterName: '_csrf' };
    else if (path === '/public/age-directions') body = { items: ageDirections };
    else if (path === '/admin/calendar') body = { items: u.searchParams.get('from')?.startsWith('2079') ? [cancelled, ...(created ? [materialized] : [])] : [], from: u.searchParams.get('from'), to: u.searchParams.get('to'), zone: 'Europe/Moscow' };
    else if (path === '/admin/session-series/calendar') body = { memberships: [membership(cancelledId, cancelledRule), ...(created ? [membership(sessionId, ruleId)] : [])], drafts: [], warnings: [] };
    else if (path === '/admin/schedule-groups') body = { items: [] };
    else if (path === '/public/schedule' || path === '/admin/permanent-schedule/projection') {
      if (failProjection) return route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE', detail: 'Расписание временно недоступно.' } });
      const inRange = (u.searchParams.get('from') || '') <= '2080-01-01T14:00:00Z' && (u.searchParams.get('to') || '') > '2080-01-01T14:00:00Z';
      const items = inRange ? [created ? { kind: 'SESSION', session: materialized } : calc(ruleId, '8–9 лет', 8, 9, '14'), calc(cancelledRule, '14+ лет', 14, null, '16')] : [];
      body = { items, page: Number(u.searchParams.get('page')), size: Number(u.searchParams.get('size')), total: items.length, containsCalculated: items.some((i) => i.kind === 'CALCULATED') };
    } else if (path === '/admin/permanent-schedule/occurrence') { opened++; created = true; body = materialized; }
    else if (path === `/admin/sessions/${sessionId}/draft`) body = { session: materialized, draft: null };
    await route.fulfill({ json: body });
  });
  return { opened: () => opened, fail: () => { failProjection = true; } };
}

test('календарь объединяет даты, не дублирует исключения и открывает только по действию', async ({ page }) => {
  const fixture = await adminFixture(page);
  await page.goto('/admin/schedule');
  await page.getByLabel('Дата', { exact: true }).fill('2080-01-01');
  const calendar = page.getByRole('region', { name: 'Календарь студии' });
  await expect(calendar.getByRole('button', { name: /8–9 лет, Постоянное расписание/ })).toBeVisible();
  await page.getByLabel('Вид').selectOption('day');
  await expect(calendar.getByRole('button', { name: /8–9 лет, Постоянное расписание/ })).toBeVisible();
  await page.getByLabel('Вид').selectOption('list');
  await expect(calendar.locator('article').getByText('Постоянное расписание', { exact: true })).toHaveCount(1);
  await expect(calendar.getByText('Отменённое занятие')).toHaveCount(1);
  await expect(calendar.getByText('14+ лет')).toHaveCount(0);
  expect(fixture.opened()).toBe(0);
  await calendar.locator('article').filter({ hasText: '8–9 лет' }).getByRole('button', { name: 'Открыть занятие' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Изменить занятие' })).toBeVisible();
  expect(fixture.opened()).toBe(1);
});

test('просмотр сотрудника не материализует расчётную дату', async ({ page }) => {
  const fixture = await adminFixture(page, true);
  await page.goto('/admin/schedule');
  await page.getByLabel('Дата', { exact: true }).fill('2080-01-01');
  await page.getByLabel('Вид').selectOption('list');
  await page.getByRole('region', { name: 'Календарь студии' }).locator('article').filter({ hasText: '8–9 лет' }).getByRole('button', { name: 'Открыть занятие' }).click();
  await expect(page.getByRole('dialog').getByText('Постоянное расписание', { exact: false })).toBeVisible();
  expect(fixture.opened()).toBe(0);
});

test('перетаскивание сохранённого занятия только предлагает перенос', async ({ page }) => {
  await adminFixture(page);
  await page.route(/\/api\/v1\/admin\/calendar\?/, (route) => route.fulfill({ json: { items: [materialized] } }));
  await page.route(/\/api\/v1\/admin\/session-series\/calendar\?/, (route) => route.fulfill({ json: { memberships: [membership(sessionId, ruleId)], drafts: [], warnings: [] } }));
  let writes = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/admin/') && request.method() !== 'GET') writes++;
  });
  await page.goto('/admin/schedule');
  await page.getByLabel('Дата', { exact: true }).fill('2080-01-01');
  const event = page.locator(`.calendar-event[data-session-id="${sessionId}"]`);
  await expect(event).toBeVisible();
  await expect(event.getByRole('button', { name: /Изменить длительность/ })).toBeVisible();
  const body = event.locator('.calendar-event-body');
  await body.scrollIntoViewIfNeeded();
  const box = await body.boundingBox();
  if (!box) throw new Error('Не удалось измерить занятие');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 45, { steps: 6 });
  await page.mouse.up();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Изменить занятие' })).toBeVisible();
  await expect(dialog.getByLabel('Начало · МСК')).not.toHaveValue('2080-01-01T17:00');
  expect(writes).toBe(0);
});

test('полная неделя показывает занятия за первой страницей без фильтра возраста', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const u = new URL(route.request().url()), path = u.pathname.split('/api/v1')[1];
    let body: unknown = {};
    if (path === '/auth/me') body = { state: 'ANONYMOUS' };
    else if (path === '/public/age-directions') body = { items: ageDirections };
    else if (path === '/public/schedule') {
      const inRange = (u.searchParams.get('from') || '') <= '2080-01-01T14:00:00Z' && (u.searchParams.get('to') || '') > '2080-01-01T14:00:00Z';
      const all = inRange ? Array.from({ length: 103 }, (_, i) => ({ kind: 'SESSION', session: {
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, version: 1, status: 'OPEN', zone: 'Europe/Moscow',
        title: i === 100 ? '8–9 лет' : i === 101 ? 'Индивидуальное занятие' : i === 102 ? '14+ лет' : `Младшая группа ${i + 1}`,
        startsAt: '2080-01-01T14:00:00Z', endsAt: '2080-01-01T15:00:00Z', capacity: 8,
        format: i === 101 ? 'INDIVIDUAL' : 'GROUP', ageFrom: i === 100 ? 8 : i === 101 ? null : i === 102 ? 14 : 3,
        ageTo: i === 100 ? 9 : i >= 101 ? null : 5, ageOpenEnded: i === 102,
      } })) : [];
      const p = Number(u.searchParams.get('page')), size = Number(u.searchParams.get('size'));
      body = { items: all.slice(p * size, (p + 1) * size), page: p, size, total: all.length, containsCalculated: false, snapshot: 'stable-fixture' };
    }
    await route.fulfill({ json: body });
  });
  await page.goto('/');
  const schedule = page.locator('#schedule');
  await expect(schedule.locator('.poster-footer')).toBeVisible();
  await schedule.getByLabel('Дата', { exact: true }).fill('2080-01-01');
  await expect(schedule.getByLabel('Возрастное направление')).toHaveCount(0);
  // polish-public-site-per-client-review: the whole week is one poster, age rows replace the filter.
  const table = schedule.getByRole('table');
  await expect(table.locator('a.poster-time')).toHaveCount(103);
  await expect(schedule.getByRole('navigation', { name: 'Расписание: страницы' })).toHaveCount(0);
  await expect(table.getByRole('row', { name: /^8–9 лет/ }).locator('a.poster-time')).toHaveCount(1);
  await expect(table.getByRole('row', { name: /^14\+ лет/ }).locator('a.poster-time')).toHaveCount(1);
  const other = table.getByRole('row', { name: /^Другие занятия/ });
  await expect(other).toContainText('Индивидуальное занятие');
  await expect(other.getByText('Младшая группа 1', { exact: true })).toBeVisible();
  await schedule.getByLabel('Дата', { exact: true }).fill('2080-01-08');
  await expect(table.getByText('Набираем группу')).toHaveCount(3);
  await schedule.getByLabel('Дата', { exact: true }).fill('2080-01-01');
  await expect(other.getByText('Младшая группа 1', { exact: true })).toBeVisible();
});

test('неполная проекция не показывает календарь как свободный', async ({ page }) => {
  const fixture = await adminFixture(page);
  await page.goto('/admin/schedule');
  await expect(page.getByRole('region', { name: 'Календарь студии' })).toBeVisible();
  fixture.fail();
  await page.getByLabel('Дата', { exact: true }).fill('2080-01-01');
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Повторить загрузку' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Календарь студии' })).toHaveCount(0);
});

for (const [source, url] of [
  ['сохранённых занятий', /\/api\/v1\/admin\/calendar\?/],
  ['связей и исключений', /\/api\/v1\/admin\/session-series\/calendar\?/],
] as const) {
  test(`ошибка источника ${source} скрывает неполный календарь`, async ({ page }) => {
    await adminFixture(page);
    await page.goto('/admin/schedule');
    await expect(page.getByRole('region', { name: 'Календарь студии' })).toBeVisible();
    await page.route(url, (route) => route.fulfill({ status: 503, json: { detail: 'Источник временно недоступен.' } }));
    await page.getByLabel('Дата', { exact: true }).fill('2080-01-01');
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Повторить загрузку' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Календарь студии' })).toHaveCount(0);
  });
}

test('фильтры постоянных правил применяются до постраничного показа', async ({ page }) => {
  await adminFixture(page);
  await page.route('**/api/v1/admin/permanent-schedule', async (route) => {
    const rules = Array.from({ length: 22 }, (_, i) => ({ seriesId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      version: 1, directionId: i === 21 ? secondDirection : firstDirection, title: i === 21 ? '14+ лет' : '8–9 лет',
      startDate: '2080-01-01', weekday: i === 21 ? 3 : 1, time: '17:00:00', durationMinutes: 60, capacity: 8 }));
    await route.fulfill({ json: { items: rules } });
  });
  await page.goto('/admin/schedule');
  await page.getByRole('button', { name: 'Постоянное расписание', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('navigation', { name: 'Расписание: страницы' })).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Направление', exact: true }).selectOption(secondDirection);
  await dialog.getByLabel('День недели').selectOption('3');
  await expect(dialog.locator('.permanent-date-list').getByText('14+ лет')).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Изменить расписание: 14\+ лет, Среда, 17:00/ })).toBeVisible();
  await expect(dialog.locator('.permanent-date-list').getByText('8–9 лет')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Сбросить фильтры' }).click();
  await expect(dialog.getByRole('navigation', { name: 'Расписание: страницы' })).toBeVisible();
});

test('прошедший расчётный план не выдаётся за проведённое занятие и не создаёт запись', async ({ page }) => {
  const fixture = await adminFixture(page);
  await page.route('**/api/v1/admin/permanent-schedule/projection**', async (route) => {
    const u = new URL(route.request().url());
    const inRange = (u.searchParams.get('from') || '') <= '2020-01-06T14:00:00Z' && (u.searchParams.get('to') || '') > '2020-01-06T14:00:00Z';
    const items = inRange ? [{ kind: 'CALCULATED', calculated: { seriesId: ruleId, originalDate: '2020-01-06', seriesVersion: 1, title: '8–9 лет', startsAt: '2020-01-06T14:00:00Z', endsAt: '2020-01-06T15:00:00Z', capacity: 8, ageFrom: 8, ageTo: 9, ageOpenEnded: false } }] : [];
    await route.fulfill({ json: { items, total: items.length, page: Number(u.searchParams.get('page')), size: Number(u.searchParams.get('size')), containsCalculated: !!items.length } });
  });
  await page.goto('/admin/schedule');
  await page.getByLabel('Дата', { exact: true }).fill('2020-01-06');
  await page.getByLabel('Вид').selectOption('list');
  const calendar = page.getByRole('region', { name: 'Календарь студии' });
  await expect(calendar.getByText('Прошедший план · проведение не подтверждено')).toBeVisible();
  await calendar.locator('article').filter({ hasText: '8–9 лет' }).getByRole('button', { name: 'Открыть занятие' }).click();
  await expect(page.getByRole('dialog').getByText(/проведение не подтверждено/)).toBeVisible();
  expect(fixture.opened()).toBe(0);
});

test('навигация и клавиатурный фокус доступны в разных размерах', async ({ page }, info) => {
  await adminFixture(page);
  await page.goto('/admin/schedule');
  const date = page.getByLabel('Дата', { exact: true });
  await expect(date).toBeVisible();
  mkdirSync('../artifacts/schedule-usability-implementation/matrix', { recursive: true });
  for (const [width, height] of [[320, 568], [375, 844], [768, 1024], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await date.focus();
    await expect(date).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: `../artifacts/schedule-usability-implementation/matrix/${info.project.name}-${width}.png` });
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await page.getByRole('button', { name: 'Сегодня', exact: true }).focus();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press(info.project.name.startsWith('webkit') ? 'Alt+Tab' : 'Tab');
    await page.waitForTimeout(80);
    const bounds = await page.evaluate(() => {
      const focused = document.activeElement!.getBoundingClientRect();
      const header = document.querySelector('.header')!.getBoundingClientRect();
      const footer = document.querySelector('.site-footer')!.getBoundingClientRect();
      return { tag: document.activeElement!.tagName, name: document.activeElement!.getAttribute('aria-label') ?? document.activeElement!.textContent?.trim().slice(0, 40), top: focused.top, bottom: focused.bottom, header: header.bottom, footer: footer.top };
    });
    expect(bounds.top, JSON.stringify(bounds)).toBeGreaterThanOrEqual(bounds.header - 1);
    expect(bounds.bottom, JSON.stringify(bounds)).toBeLessThanOrEqual(bounds.footer + 1);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: `../artifacts/schedule-usability-implementation/matrix/${info.project.name}-320-200.png` });
});

test('изменение недельной выборки при одинаковом количестве не скрывает занятия', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const u = new URL(route.request().url()), path = u.pathname.split('/api/v1')[1];
    let body: unknown = {};
    if (path === '/auth/me') body = { state: 'ANONYMOUS' };
    else if (path === '/public/age-directions') body = { items: ageDirections };
    else if (path === '/public/schedule') {
      const inRange = (u.searchParams.get('from') || '') <= '2080-01-01T14:00:00Z' && (u.searchParams.get('to') || '') > '2080-01-01T14:00:00Z';
      const p = Number(u.searchParams.get('page')), size = Number(u.searchParams.get('size'));
      const all = inRange ? Array.from({ length: 101 }, (_, i) => ({ kind: 'SESSION', session: {
        id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, version: 1, status: 'OPEN', zone: 'Europe/Moscow',
        title: `Группа ${i + 1}`, startsAt: '2080-01-01T14:00:00Z', endsAt: '2080-01-01T15:00:00Z',
        capacity: 8, format: 'GROUP', ageFrom: 8, ageTo: 9, ageOpenEnded: false,
      } })) : [];
      body = { items: all.slice(p * size, (p + 1) * size), page: p, size, total: all.length, containsCalculated: false, snapshot: p === 0 ? 'before' : 'after' };
    }
    await route.fulfill({ json: body });
  });
  await page.goto('/');
  const schedule = page.locator('#schedule');
  await expect(schedule.locator('.poster-footer')).toBeVisible();
  await schedule.getByLabel('Дата', { exact: true }).fill('2080-01-01');
  await expect(schedule.getByRole('alert')).toContainText('Не удалось загрузить расписание');
  await expect(schedule.locator('.poster-footer')).toHaveCount(0);
  await expect(schedule.locator('a.poster-time')).toHaveCount(0);
});

test('перенесённое занятие остаётся в новом времени без дубля правила', async ({ page }) => {
  await adminFixture(page);
  const moved = { ...cancelled, title: 'Перенесено', status: 'OPEN', startsAt: '2080-01-02T16:00:00Z', endsAt: '2080-01-02T17:00:00Z' };
  await page.route('**/api/v1/admin/calendar**', async (route) => {
    const u = new URL(route.request().url());
    const inRange = (u.searchParams.get('from') || '') <= moved.startsAt && (u.searchParams.get('to') || '') > moved.startsAt;
    await route.fulfill({ json: { items: inRange ? [moved] : [], from: u.searchParams.get('from'), to: u.searchParams.get('to'), zone: 'Europe/Moscow' } });
  });
  await page.goto('/admin/schedule');
  await page.getByLabel('Дата', { exact: true }).fill('2080-01-01');
  await page.getByLabel('Вид').selectOption('list');
  const calendar = page.getByRole('region', { name: 'Календарь студии' });
  await expect(calendar.getByText('Перенесено')).toHaveCount(1);
  await expect(calendar.getByText('14+ лет')).toHaveCount(0);
  await expect(calendar.getByText('Разовое изменение', { exact: false })).toHaveCount(1);
});

test('занятие, начавшееся до выбранного дня, видно после полуночи', async ({ page }) => {
  await adminFixture(page);
  await page.route('**/api/v1/admin/permanent-schedule/projection**', async (route) => {
    const u = new URL(route.request().url());
    const inRange = (u.searchParams.get('from') || '') <= '2079-12-31T20:30:00Z' && (u.searchParams.get('to') || '') > '2079-12-31T20:30:00Z';
    const items = inRange ? [{ kind: 'CALCULATED', calculated: { seriesId: ruleId, originalDate: '2079-12-31', seriesVersion: 1, title: 'Ночной план', startsAt: '2079-12-31T20:30:00Z', endsAt: '2079-12-31T21:30:00Z', capacity: 8, ageFrom: 8, ageTo: 9, ageOpenEnded: false } }] : [];
    await route.fulfill({ json: { items, total: items.length, page: Number(u.searchParams.get('page')), size: Number(u.searchParams.get('size')), containsCalculated: !!items.length } });
  });
  await page.goto('/admin/schedule');
  await page.getByLabel('Дата', { exact: true }).fill('2080-01-01');
  await page.getByLabel('Вид').selectOption('day');
  await expect(page.getByRole('region', { name: 'Календарь студии' }).getByRole('button', { name: /Ночной план/ })).toBeVisible();
});

test('неизвестный результат открытия уточняется прежним ключом без второй команды', async ({ page }) => {
  await adminFixture(page);
  const keys: string[] = [];
  await page.route('**/api/v1/admin/permanent-schedule/occurrence', async (route) => {
    keys.push(route.request().headers()['idempotency-key']);
    if (keys.length === 1) return route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE', detail: 'Результат неизвестен.' } });
    return route.fulfill({ json: materialized });
  });
  await page.goto('/admin/schedule');
  await page.getByLabel('Дата', { exact: true }).fill('2080-01-01');
  await page.getByLabel('Вид').selectOption('list');
  const open = page.getByRole('region', { name: 'Календарь студии' }).locator('article').filter({ hasText: '8–9 лет' }).getByRole('button', { name: 'Открыть занятие' });
  await open.click();
  const status = page.getByRole('region', { name: 'Состояние сохранения' });
  await expect(status).toContainText('Результат пока неизвестен');
  await open.click();
  expect(keys).toHaveLength(1);
  await status.getByRole('button', { name: 'Уточнить результат' }).click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[1]).toBe(keys[0]);
  await expect(status).toHaveCount(0);
});

test('поздний ответ старой недели не заменяет выбранную неделю', async ({ page }) => {
  await adminFixture(page);
  await page.route('**/api/v1/admin/permanent-schedule/projection**', async (route) => {
    const u = new URL(route.request().url());
    const from = u.searchParams.get('from') || '';
    const oldWeek = from.startsWith('2079-12-24');
    const newWeek = from.startsWith('2079-12-31');
    if (oldWeek) await new Promise((resolve) => setTimeout(resolve, 700));
    const date = oldWeek ? '2080-01-01' : '2080-01-08';
    const items = oldWeek || newWeek ? [{ kind: 'CALCULATED', calculated: { seriesId: ruleId, originalDate: date, seriesVersion: 1, title: oldWeek ? 'Старая неделя' : 'Новая неделя', startsAt: `${date}T14:00:00Z`, endsAt: `${date}T15:00:00Z`, capacity: 8, ageFrom: 8, ageTo: 9, ageOpenEnded: false } }] : [];
    await route.fulfill({ json: { items, total: items.length, page: Number(u.searchParams.get('page')), size: Number(u.searchParams.get('size')), containsCalculated: !!items.length, snapshot: date } });
  });
  await page.goto('/admin/schedule');
  await expect(page.getByRole('region', { name: 'Календарь студии' })).toBeVisible();
  await page.getByLabel('Вид').selectOption('list');
  await page.getByLabel('Дата', { exact: true }).fill('2080-01-01');
  await page.getByLabel('Дата', { exact: true }).fill('2080-01-08');
  const calendar = page.getByRole('region', { name: 'Календарь студии' });
  await expect(calendar.getByText('Новая неделя')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(calendar.getByText('Старая неделя')).toHaveCount(0);
  await expect(calendar.getByText('Новая неделя')).toBeVisible();
});
