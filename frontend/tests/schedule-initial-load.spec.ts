import { expect, test } from '@playwright/test';

const fixture = 'http://127.0.0.1:48834';
const mode = (value: string) => fetch(`${fixture}/__fixture/mode?mode=${value}`);

test.beforeEach(() => mode('full'));

test('афиша запрашивается один раз, содержит воскресенье и несколько времён в ячейке', async ({ page }) => {
  await page.goto('/#schedule');
  const grid = page.locator('.poster-table');
  await expect(grid.locator('.poster-slot')).toHaveCount(3);
  await expect(grid.getByRole('columnheader', { name: 'Воскресенье' })).toBeVisible();
  await expect(grid.locator('td').filter({ has: page.locator('.poster-time') }).first().locator('a')).toHaveCount(2);
  expect((await (await fetch(fixture + '/__fixture/requests')).json()).requests).toEqual(['weekly']);
});

test('медленное расписание не задерживает основной контент', async ({ page }) => {
  await mode('slow');
  const started = performance.now();
  await page.goto('/#schedule', { waitUntil: 'commit' });
  await expect(page.locator('.landing-hero h1')).toBeVisible({ timeout: 1000 });
  expect(performance.now() - started).toBeLessThan(1500);
  await expect(page.getByText('Загружаем расписание…')).toBeVisible({ timeout: 1000 });
  await expect(page.locator('.poster-card')).toBeVisible({ timeout: 6000 });
});

test('ответ главной с расписанием запрещает сохранение в общем кеше', async ({ request }) => {
  const response = await request.get('/');
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(response.headers()['x-accel-buffering']).toBe('no');
});

test('все интервалы выдаются одним запросом', async ({ page }) => {
  await mode('many');
  await page.goto('/#schedule');
  await expect(page.locator('.poster-table .poster-slot')).toHaveCount(126);
  expect((await (await fetch(fixture + '/__fixture/requests')).json()).requests).toEqual(['weekly']);
});

test('форма заявки подключается без расхождения серверной даты', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/enquiry');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Заявка на занятие' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('при выключенном JavaScript сохраняется единственная ссылка на заявку', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(baseURL!);
  await expect(page.locator('#schedule .schedule-static')).toHaveCount(1);
  await expect(page.locator('#schedule .schedule-static a')).toHaveAttribute('href', '/enquiry');
  await context.close();
});

test('позднее расписание сохраняет фокус и положение при чтении раздела выше', async ({ page }) => {
  await mode('slow');
  await page.goto('/', { waitUntil: 'commit' });
  const link = page.locator('#formats h3 a').first();
  await expect(page.getByText('Загружаем расписание…')).toBeVisible();
  await link.evaluate((el) => {
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    el.focus({ preventScroll: true });
  });
  // Let the sticky header finish its compact transition after this explicit scroll.
  await page.waitForFunction(() => !document.querySelector('.header')?.getAnimations({ subtree: true }).some(a => a.playState === 'running'));
  await page.waitForTimeout(350);
  await expect(page.getByText('Загружаем расписание…')).toBeVisible();
  const before = await page.evaluate(() => window.scrollY);
  await expect(page.locator('.poster-table')).toBeAttached();
  await expect(link).toBeFocused();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThan(3);
});
