import { expect, test, type Page } from '@playwright/test';

async function scrollToTop(page: Page) {
  await page.mouse.move(20, 350);
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(70);
    if (await page.evaluate(() => scrollY === 0)) break;
  }
  // Header transitions and ResizeObserver callbacks continue after reaching the top.
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => scrollY)).toBeLessThanOrEqual(2);
}

for (const [width, height] of [
  [1440, 900],
  [375, 812],
]) {
  test(`после смены недели можно прокрутить вверх: ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.locator('.poster-footer')).toBeVisible();
    const range = page.locator('.poster-range');
    const initial = await range.textContent();
    const next = page.getByRole('button', { name: 'Следующая неделя' });
    await next.click();
    // WebKit on macOS does not focus a button on pointer click by default.
    await next.focus();
    await expect(range).not.toHaveText(initial!);
    const selected = await range.textContent();
    await expect(next).toBeFocused();
    await scrollToTop(page);
    await expect(range).toHaveText(selected!);
    await expect(next).toBeFocused();
  });
}

test('выбор даты и возврат к текущей неделе не мешают прокрутке', async ({ page, request }) => {
  await request.get('http://127.0.0.1:48794/__fixture/mode?mode=full');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#schedule');
  const range = page.locator('.poster-range');
  const current = await range.textContent();
  await page.getByRole('button', { name: 'Следующая неделя' }).click();
  await page.getByRole('button', { name: 'Предыдущая неделя' }).click();
  await expect(range).toHaveText(current!);
  await scrollToTop(page);

  await page.getByLabel('Дата').fill('2080-01-03');
  await expect(range).toHaveText('1 — 7 января');
  await scrollToTop(page);
  await page.getByRole('button', { name: 'Текущая неделя' }).click();
  await expect(range).toHaveText(current!);
  await scrollToTop(page);
});

test('ближайшее занятие и пустая неделя при задержке загрузки', async ({ page, request }) => {
  await request.get('http://127.0.0.1:48794/__fixture/mode?mode=gap');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/v1/public/schedule?*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.continue();
  });
  await page.goto('/#schedule');
  const range = page.locator('.poster-range');
  const current = await range.textContent();
  const next = page.getByRole('button', { name: 'Показать следующую неделю' }).first();
  await expect(next).toBeVisible();
  await next.click();
  await expect(range).not.toHaveText(current!);
  await expect(page.locator('a.poster-time').first()).toBeVisible();
  await scrollToTop(page);

  await request.get('http://127.0.0.1:48794/__fixture/mode?mode=empty');
  await page.reload();
  await expect(page.getByText('Набираем группу').first()).toBeVisible();
  await page.getByRole('button', { name: 'Следующая неделя' }).click();
  await expect(page.getByText('Набираем группу').first()).toBeVisible();
  await scrollToTop(page);
  await request.get('http://127.0.0.1:48794/__fixture/mode?mode=full');
});

test('клавиатура и изменение окна после ручной прокрутки', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#schedule');
  const next = page.getByRole('button', { name: 'Следующая неделя' });
  await next.focus();
  await page.keyboard.press('Enter');
  await scrollToTop(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => scrollY)).toBeLessThanOrEqual(2);
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const box = document.activeElement!.getBoundingClientRect();
        const top = document.querySelector('.header')!.getBoundingClientRect().bottom;
        const bottom = document.querySelector('.site-footer')!.getBoundingClientRect().top;
        return box.top >= top - 1 && box.bottom <= bottom + 1;
      }),
    )
    .toBe(true);
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
  await expect(next).toBeFocused();
  await expect
    .poll(() =>
      next.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return (
          box.top >= document.querySelector('.header')!.getBoundingClientRect().bottom - 1 &&
          box.bottom <= document.querySelector('.site-footer')!.getBoundingClientRect().top + 1
        );
      }),
    )
    .toBe(true);
});

test('афиша появляется один раз и перелистывается по направлению даты', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/#schedule');
  const panel = page.locator('.poster-motion-panel');
  const next = page.getByRole('button', { name: 'Следующая неделя', exact: true });
  const current = page.getByRole('button', { name: 'Текущая неделя', exact: true });
  await expect(panel).toHaveAttribute('data-transition', 'enter');
  await expect(panel).toHaveCSS('animation-name', 'poster-week-in');
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toHaveAttribute('data-transition', 'forward');
  await expect(next).toBeFocused();
  await current.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toHaveAttribute('data-transition', 'backward');
  await expect(current).toBeFocused();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(panel).toHaveCSS('animation-name', 'none');
});

test('поздний ответ предыдущего выбора не заменяет неделю после ошибки и повтора', async ({
  page,
}) => {
  await page.goto('/#schedule');
  await expect(page.locator('.poster-footer')).toBeVisible();
  const date = page.getByLabel('Дата', { exact: true });
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fail = true;
  await page.route('**/api/v1/public/schedule?*', async (route) => {
    const from = new URL(route.request().url()).searchParams.get('from');
    if (from?.startsWith('2080-01-07')) await delayed;
    if (from?.startsWith('2080-01-14') && fail) {
      await route.fulfill({ status: 503, json: {} });
      return;
    }
    await route.continue();
  });
  const firstRequest = page.waitForRequest((req) => req.url().includes('2080-01-07'));
  await date.fill('2080-01-08');
  await firstRequest;
  await expect(page.getByText('Загрузка расписания…', { exact: true })).toBeVisible();
  await date.fill('2080-01-15');
  await expect(page.getByRole('button', { name: 'Повторить загрузку', exact: true })).toBeVisible();
  fail = false;
  release();
  await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
  await expect(page.locator('.poster-range')).toHaveText('15 — 21 января');
  await expect(page.locator('.poster-table thead time').first()).toHaveAttribute(
    'datetime',
    '2080-01-15',
  );
});
