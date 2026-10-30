import { test, expect, type Page, type Route } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const output = process.env.LAYOUT_OUTPUT ?? '../artifacts/schedule-layout/after';
mkdirSync(output, { recursive: true });
const session = (n = 1, status = 'OPEN') => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  title: 'Оздоровительная гимнастика',
  format: 'GROUP',
  capacity: 6,
  ageFrom: 7,
  ageTo: 10,
  startsAt: '2026-10-30T07:00:00Z',
  endsAt: '2026-10-30T07:50:00Z',
  status,
  version: 0,
  zone: 'Europe/Moscow',
});
async function mock(page: Page, filled = false) {
  await page.route('**/api/v1/sessions?*', (r) =>
    r.fulfill({
      json: {
        items: filled ? [session(), session(2, 'CLOSED')] : [],
        page: 0,
        size: 20,
        total: filled ? 2 : 0,
      },
    }),
  );
}
async function ready(page: Page) {
  await page.goto('./#schedule');
  await expect(page.locator('.schedule-period input')).toBeVisible();
  await expect(page.getByText('Загрузка расписания…', { exact: true })).toBeHidden();
}
async function geometry(page: Page, wide = false) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const elements = page.locator('.period-controls button, .period-controls input');
  const boxes = await elements.evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
    }),
  );
  for (const r of boxes) {
    expect(r.height).toBeGreaterThanOrEqual(44);
    expect(r.width).toBeGreaterThanOrEqual(44);
  }
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      expect(
        Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1,
      ).toBe(false);
    }
  if (wide)
    expect(
      Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.bottom)),
    ).toBeLessThanOrEqual(2);
  const gap = await page.locator('.period-navigation label').evaluate((n) => {
    const span = n.querySelector('span')!.getBoundingClientRect(),
      input = n.querySelector('input')!.getBoundingClientRect();
    return input.top - span.bottom;
  });
  expect(gap).toBeGreaterThanOrEqual(12);
  const field = page.getByLabel('Дата', { exact: true });
  await field.focus();
  expect(
    await field.evaluate((n) => Number.parseFloat(getComputedStyle(n).outlineWidth)),
  ).toBeGreaterThanOrEqual(2);
}
test('layout matrix, empty and filled, text enlargement and keyboard', async ({ page }, info) => {
  for (const filled of [false, true]) {
    await page.goto('about:blank');
    await mock(page, filled);
    await ready(page);
    if (filled) {
      await expect(page.locator('.session-card')).toHaveCount(2);
      await expect(page.locator('.schedule-empty')).toHaveCount(0);
      await expect(page.locator('.session-card a')).toHaveCount(1);
    } else {
      await expect(page.locator('.schedule-empty')).toBeVisible();
      await expect(page.locator('.general-enquiry')).toHaveCount(0);
    }
    for (const width of [320, 375, 768, 1000, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      await geometry(page, width >= 1440);
      await page.screenshot({
        path: `${output}/${info.project.name}-${width}-${filled ? 'filled' : 'empty'}.png`,
        fullPage: true,
      });
    }
    for (const width of [320, 375, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.addStyleTag({ content: 'html {font-size:200% !important}' });
      await geometry(page);
      await page.screenshot({
        path: `${output}/${info.project.name}-${width}-${filled ? 'filled' : 'empty'}-200.png`,
        fullPage: true,
      });
      await page
        .locator('style')
        .last()
        .evaluate((n) => n.remove());
    }
    await page.getByRole('button', { name: 'Эта неделя', exact: true }).focus();
    await page.keyboard.press(info.project.use.browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(page.getByRole('button', { name: 'Следующая неделя', exact: true })).toBeFocused();
    await page.keyboard.press(info.project.use.browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(
      page.getByRole('button', { name: 'Предыдущая неделя', exact: true }),
    ).toBeFocused();
    await page.keyboard.press(info.project.use.browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
    await expect(page.getByLabel('Дата', { exact: true })).toBeFocused();
    await page.unroute('**/api/v1/sessions?*');
  }
});
test('periods, pagination, stale responses, errors and links', async ({ page }) => {
  const queries: URL[] = [];
  let failure = false;
  let delayed: Route | undefined;
  await page.clock.setFixedTime(new Date('2026-10-26T00:30:00+03:00'));
  await page.route('**/api/v1/sessions?*', async (r) => {
    const u = new URL(r.request().url());
    queries.push(u);
    if (u.searchParams.get('from') === '2026-11-08T21:00:00.000Z') {
      delayed = r;
      return;
    }
    if (failure) {
      await r.fulfill({
        status: 503,
        json: { code: 'SERVICE_UNAVAILABLE', detail: 'Сервис временно недоступен' },
      });
      return;
    }
    const p = Number(u.searchParams.get('page'));
    await r.fulfill({
      json: { items: p ? [session(21)] : [session()], page: p, size: 20, total: 21 },
    });
  });
  await ready(page);
  await expect(page.getByLabel('Дата', { exact: true })).toHaveValue('2026-10-26');
  expect(queries.at(-1)!.searchParams.get('from')).toBe('2026-10-25T21:00:00.000Z');
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await expect(page.getByText('Расписание: страница 2 из 2')).toBeVisible();
  await page.getByRole('button', { name: 'Следующая неделя', exact: true }).click();
  await expect(page.getByLabel('Дата', { exact: true })).toHaveValue('2026-11-02');
  await expect(page.getByText('Расписание: страница 1 из 2')).toBeVisible();
  await page.getByRole('button', { name: 'Предыдущая неделя', exact: true }).click();
  await expect(page.getByLabel('Дата', { exact: true })).toHaveValue('2026-10-26');
  await page.getByLabel('Дата', { exact: true }).fill('2026-11-11');
  await expect.poll(() => !!delayed).toBe(true);
  await page.getByRole('button', { name: 'Эта неделя', exact: true }).click();
  await expect(page.locator('.session-card')).toHaveCount(1);
  await delayed!.fulfill({ json: { items: [], page: 0, size: 20, total: 0 } });
  await expect(page.locator('.schedule-empty')).toHaveCount(0);
  failure = true;
  await page.getByRole('button', { name: 'Следующая неделя', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Повторить загрузку' })).toBeVisible();
  await expect(page.locator('.schedule-empty')).toHaveCount(0);
  failure = false;
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(page.locator('.session-card')).toHaveCount(1);
  await page.locator('.session-card a').click();
  await expect(page).toHaveURL(/\/enquiry\?session=00000000-0000-4000-8000-000000000001/);
  await page.goto('./#schedule');
  await expect(page.locator('.general-enquiry a')).toBeVisible();
  await page.locator('.general-enquiry a').click();
  await expect(page).toHaveURL(/\/enquiry$/);
});
test('pending request does not claim empty schedule', async ({ page }) => {
  let pending: Route | undefined;
  await page.route('**/api/v1/sessions?*', (r) => {
    pending = r;
  });
  await page.goto('./#schedule');
  await expect(page.getByText('Загрузка расписания…', { exact: true })).toBeVisible();
  await expect(page.locator('.schedule-empty')).toHaveCount(0);
  await expect.poll(() => !!pending).toBe(true);
  await pending!.fulfill({ json: { items: [], page: 0, size: 20, total: 0 } });
  await expect(page.locator('.schedule-empty')).toBeVisible();
  await page.locator('.schedule-empty a').click();
  await expect(page).toHaveURL(/\/enquiry$/);
});

test('server-rendered week hydrates without browser errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mock(page);
  await ready(page);
  await page.getByRole('button', { name: 'Следующая неделя', exact: true }).click();
  await expect(page.locator('.schedule-empty')).toBeVisible();
  await page.locator('.schedule-empty a').click();
  await expect(page.getByLabel('Телефон', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
