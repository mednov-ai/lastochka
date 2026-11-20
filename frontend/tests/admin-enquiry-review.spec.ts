import { expect, test, type Page } from '@playwright/test';

const common = {
  parentName: 'Анна',
  phone: '+79001234567',
  createdAt: '2026-11-19T09:03:00Z',
  ageDirection: { title: '3–5 лет' },
};
const current = {
  ...common,
  id: 'weekly',
  number: 7,
  desiredSessionSnapshot:
    'Пожелание: среда, 17:00–17:45 МСК, 3–5 лет. Дату согласует администратор.',
};
const custom = 'Пожелание: по возможности вечером, 3–5 лет. Дату согласует администратор.';
const historical = {
  ...common,
  id: 'old',
  number: 6,
  desiredSessionSnapshot: custom,
  phone: 'доб. 45',
};

async function setup(page: Page) {
  const writes: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.split('/api/v1')[1];
    if (path.startsWith('/public/')) return route.continue();
    if (request.method() !== 'GET') writes.push(path);
    if (path === '/auth/me')
      return route.fulfill({
        json: { state: 'FULL', account: { id: 'fixture', role: 'ADMIN', permissions: [] } },
      });
    if (path === '/auth/csrf')
      return route.fulfill({ json: { headerName: 'X-CSRF-TOKEN', token: 'fixture' } });
    if (path === '/admin/enquiries')
      return route.fulfill({
        json: {
          items:
            url.searchParams.get('page') === '1'
              ? [current, historical]
              : [{ ...common, id: 'recent', number: 32 }],
          total: 27,
        },
      });
    if (path.endsWith('/delivery/retry'))
      return route.fulfill({ json: { status: 'DELIVERED', configured: true } });
    if (path.endsWith('/delivery'))
      return route.fulfill({ json: { status: 'FAILED', configured: true } });
    if (path.endsWith('/browser-push')) return route.abort();
    return route.fulfill({ json: {} });
  });
  await page.goto('admin/requests');
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  return writes;
}

test('вторая страница, одинаковые имена и исторический текст сохраняются при просмотре', async ({
  page,
}) => {
  const writes = await setup(page);
  const older = page.getByRole('button', { name: 'Открыть заявку №6', exact: true });
  const row = page.locator('article').filter({ has: older });
  await expect(row).toContainText(custom);
  await expect(row).toContainText('Анна');
  await expect(
    page
      .locator('article')
      .filter({ has: page.getByRole('button', { name: 'Открыть заявку №7' }) }),
  ).toContainText('Среда, 17:00–17:45 МСК');
  await older.click();
  const card = page.getByRole('dialog', { name: 'Заявка №6' });
  await expect(card.getByText(custom, { exact: true })).toBeVisible();
  await expect(card.getByText('доб. 45', { exact: true })).toBeVisible();
  await expect(card.getByRole('link', { name: /Позвонить/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(older).toBeFocused();
  await expect(page.getByText('Заявки: страница 2 из 2')).toBeVisible();
  expect(writes).toEqual([]);
});

test('повтор Telegram сохраняет ошибку push и выполняется только по нажатию', async ({ page }) => {
  const writes = await setup(page);
  await page.getByRole('button', { name: 'Открыть заявку №7' }).click();
  const card = page.getByRole('dialog');
  await expect(card.locator('summary')).toContainText('Требует внимания');
  await card.locator('summary').click();
  const push = card.locator('dl > div').filter({ hasText: 'Уведомления браузера' });
  await expect(push.getByRole('alert')).toBeVisible();
  expect(writes).toEqual([]);
  await card.getByRole('button', { name: 'Повторить доставку' }).click();
  await expect(card.getByText('Доставлено', { exact: true })).toBeVisible();
  await expect(push.getByRole('alert')).toBeVisible();
  await card.locator('summary').click();
  await expect(card.locator('summary')).toContainText('Требует внимания');
  expect(writes).toEqual(['/admin/enquiries/weekly/delivery/retry']);
});

test('опоздавший ответ оставляет состояния текущей заявки', async ({ page }) => {
  await setup(page);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route('**/enquiries/weekly/delivery', async (route) => {
    await pending;
    await route.fulfill({ json: { status: 'DELIVERED', configured: true } });
  });
  await page.route('**/browser-push', (route) => route.fulfill({ json: { selected: false } }));
  const first = page.waitForRequest((request) => request.url().endsWith('/weekly/delivery'));
  await page.getByRole('button', { name: 'Открыть заявку №7' }).click();
  await first;
  const card = page.getByRole('dialog');
  await card.locator('summary').click();
  await expect(card.getByText('Канал не был выбран')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Открыть заявку №6' }).click();
  await card.locator('summary').click();
  await expect(card.getByText('Не удалось доставить')).toBeVisible();
  const completed = page.waitForEvent('requestfinished', {
    predicate: (r) => r.url().endsWith('/weekly/delivery'),
  });
  finish();
  await completed;
  await expect(card).toHaveAccessibleName('Заявка №6');
  await expect(card.getByText('Не удалось доставить')).toBeVisible();
  await expect(card.getByText('Доставлено', { exact: true })).toHaveCount(0);
});

test('отказ Telegram оставляет доступным полученный статус браузерных уведомлений', async ({
  page,
}) => {
  const writes = await setup(page);
  await page.route('**/weekly/delivery', (route) => route.abort());
  await page.route('**/weekly/browser-push', (route) =>
    route.fulfill({
      json: {
        selected: true,
        configured: true,
        subscriptions: 1,
        waiting: 0,
        accepted: 1,
        failed: 0,
      },
    }),
  );
  await page.getByRole('button', { name: 'Открыть заявку №7' }).click();
  const card = page.getByRole('dialog');
  await expect(card.locator('summary')).toContainText('Требует внимания');
  await card.locator('summary').click();
  await expect(
    card.locator('dl > div').filter({ hasText: 'Telegram' }).getByRole('alert'),
  ).toBeVisible();
  await expect(card.getByText('Принято сервисом: 1.', { exact: false })).toBeVisible();
  await expect(card.getByRole('link', { name: /Позвонить/ })).toBeVisible();
  expect(writes).toEqual([]);
});
