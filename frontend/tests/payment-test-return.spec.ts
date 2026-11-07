import { expect, test } from '@playwright/test';

test('поддельный переход не подтверждает оплату и не передаёт параметры', async ({ page }) => {
  const marker = 'test-private-identifier-94732';
  const requests: { url: string; method: string; referer: string }[] = [];
  page.on('request', (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      referer: request.headers().referer ?? '',
    }),
  );
  const response = await page.goto(`payments/test/return?orderId=${marker}&status=paid`, {
    waitUntil: 'networkidle',
  });
  expect(response?.status()).toBe(200);
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  expect(response?.headers()['cache-control']).toContain('no-store');
  expect(response?.headers()['x-robots-tag']).toContain('noindex');
  expect(response?.headers()['content-security-policy']).toContain("connect-src 'none'");
  expect(await response?.text()).not.toContain(marker);
  await expect(page.getByRole('heading', { name: 'Возврат после тестовой оплаты' })).toBeVisible();
  await expect(page.getByText(/Сам переход на неё не подтверждает оплату/)).toBeVisible();
  await expect(page.locator('body')).not.toContainText(marker);
  await expect(page.locator('body')).not.toContainText('Оплата подтверждена');
  expect(
    requests.filter((request) => new URL(request.url).origin !== 'http://127.0.0.1:18181'),
  ).toEqual([]);
  expect(requests.filter((request) => request.method !== 'GET')).toEqual([]);
  expect(requests.filter((request) => new URL(request.url).pathname.includes('/api/'))).toEqual([]);
  expect(
    requests
      .slice(1)
      .filter((request) => request.url.includes(marker) || request.referer.includes(marker)),
  ).toEqual([]);
  const anchors = await page
    .locator('a')
    .evaluateAll((items) => items.map((item) => (item as HTMLAnchorElement).href));
  expect(anchors.every((href) => new URL(href).origin === 'http://127.0.0.1:18181')).toBe(true);
  expect(
    await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)),
  ).toBe(0);

  let nextReferer: string | undefined;
  await page.route('**/lastochka/', async (route) => {
    nextReferer = route.request().headers().referer;
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Fixture</title>',
    });
  });
  await page.getByRole('link', { name: 'На главную' }).click();
  expect(nextReferer).toBeUndefined();
});

test('страница работает без сценариев и без работающего банка', async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 600 },
  });
  try {
    const page = await context.newPage();
    const response = await page.goto(
      'http://127.0.0.1:18181/lastochka/payments/test/return?status=paid',
    );
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: 'Возврат после тестовой оплаты' }),
    ).toBeVisible();
    await expect(page.getByText(/Сам переход на неё не подтверждает оплату/)).toBeVisible();
  } finally {
    await context.close();
  }
});
