import { expect, test } from '@playwright/test';

test('фотографии, возрастные направления и ссылка сообщества доступны на главной', async ({
  page,
}) => {
  await page.goto('./');
  await expect(page.locator('.landing-hero-photo img')).toHaveAttribute(
    'src',
    /\/images\/hero\.webp$/,
  );
  await expect(page.locator('.landing-formats-list img')).toHaveCount(3);
  await expect(page.locator('.landing-coach-photo img')).toHaveAttribute(
    'src',
    /\/images\/coach\.webp$/,
  );
  await expect(page.getByRole('heading', { name: '8–9 лет' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '10–13 лет' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '14+ лет' })).toBeVisible();
  const links = page.getByRole('link', { name: 'Сообщество ВКонтакте' });
  await expect(links).toHaveCount(2);
  for (const link of await links.all())
    await expect(link).toHaveAttribute('href', 'https://vk.ru/lastochkagym');
  await expect(page.getByText('Познакомиться с тренером', { exact: true })).toHaveCount(0);
});

test('фотографии сохраняют пропорции и страница помещается на разных экранах', async ({ page }) => {
  for (const width of [320, 375, 390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./');
    const photos = page.locator(
      '.landing-hero-photo img, .landing-formats-list img, .landing-coach-photo img',
    );
    for (const photo of await photos.all()) {
      await photo.scrollIntoViewIfNeeded();
      await expect(photo).toBeVisible();
      await expect
        .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
      expect(await photo.evaluate((image) => getComputedStyle(image).objectFit)).not.toBe('cover');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }
});

test('изображения и запись доступны без JavaScript при снижении движения', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    reducedMotion: 'reduce',
    viewport: { width: 375, height: 844 },
  });
  const page = await context.newPage();
  await page.goto(baseURL!);
  await expect(page.locator('.landing-hero-photo img')).toBeVisible();
  await expect(page.locator('.landing-formats-list img')).toHaveCount(3);
  await expect(page.locator('.landing-coach-photo img')).toBeVisible();
  await page.getByRole('link', { name: 'Хочу на первое занятие' }).click();
  await expect(page.getByRole('heading', { name: 'Заявка на занятие' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Для ребёнка' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Для себя' })).toBeVisible();
  await context.close();
});

test('увеличенный текст и клавиатурный фокус не перекрывают действия', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('./');
  await expect(page.getByText('На этой неделе пока нет занятий')).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const booking = page.getByRole('link', { name: 'Хочу на первое занятие' });
  await booking.focus();
  await expect(booking).toBeFocused();
  await expect(booking).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Заявка на занятие' })).toBeVisible();
});

test('выбранное занятие сохраняется при переходе к заявке', async ({ page }) => {
  const startsAt = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
  const session = {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Проверочное занятие',
    format: 'GROUP',
    capacity: 8,
    ageFrom: 14,
    ageTo: null,
    ageOpenEnded: true,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.valueOf() + 3600000).toISOString(),
    status: 'OPEN',
    version: 1,
    zone: 'Europe/Moscow',
  };
  await page.route('**/api/v1/public/schedule?*', (route) =>
    route.fulfill({ json: { items: [{ kind: 'SESSION', session }], page: 0, size: 20, total: 1, containsCalculated: false } }),
  );
  await page.goto('./');
  await expect(page.locator('#schedule .schedule-table')).toBeVisible();
  const sessionDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(startsAt);
  await page.locator('#schedule').getByLabel('Дата', { exact: true }).fill(sessionDate);
  await page.getByRole('link', { name: /Оставить заявку: Проверочное занятие/ }).click();
  await expect(page.getByRole('heading', { name: 'Заявка на занятие' })).toBeVisible();
  await expect(page.locator('input[name="desiredSessionId"]')).toHaveValue(session.id);
  await expect(page.locator('input[name="desiredSessionVersion"]')).toHaveValue('1');
  await page.getByRole('button', { name: 'Для себя' }).click();
  await expect(page.getByLabel('Ваш возраст')).toBeVisible();
  await expect(page.locator('input[name="desiredSessionId"]')).toHaveValue(session.id);
  await expect(page.getByText('Проверочное занятие')).toBeVisible();
});
