import { expect, test, type Page } from '@playwright/test';

function payment(id: number, archived = false) {
  return {
    id: String(id),
    amountMinor: 12300,
    purpose: `Занятие ${id}`,
    recipientName: 'Родитель',
    phone: '+79001234567',
    enquiryId: null,
    version: 1,
    status: 'DRAFT',
    currency: 'RUB',
    createdAt: '2026-01-01T00:00:00Z',
    paymentLinkIssuanceAvailable: !archived && id === 1,
    bankStatus: archived ? 'PAID' : id === 2 ? 'DECLINED' : 'REGISTERED',
    operationState: archived ? 'PAID' : id === 2 ? 'DECLINED' : 'OPEN',
    snapshotPurpose: id === 3 ? 'Исходное занятие' : null,
    snapshotAmountMinor: id === 3 ? 10000 : null,
    bankCheckedAt: '2026-11-06T10:00:00Z',
    bankError: id === 3 ? 'NETWORK' : null,
    archived,
    canCancel: !archived && id === 1,
    canArchive: !archived && id === 2,
    canRefresh: !archived,
    linkAvailable: !archived && id === 1,
  };
}

async function fixture(page: Page, staffReadOnly = false, failCandidate = false) {
  const active = Array.from({ length: 21 }, (_, index) => payment(index + 1));
  const archived = Array.from({ length: 21 }, (_, index) => payment(index + 101, true));
  const commands: string[] = [];
  let candidatePresent = false;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.split('/api/v1')[1];
    const method = request.method();
    let body: unknown = {};
    if (path === '/auth/me')
      body = {
        state: 'FULL',
        account: {
          id: 'self',
          login: 'tester',
          name: 'Сотрудник',
          role: staffReadOnly ? 'STAFF' : 'ADMIN',
          roles: [staffReadOnly ? 'STAFF' : 'ADMIN'],
          permissions: staffReadOnly ? ['PAYMENT_VIEW'] : [],
        },
      };
    else if (path === '/auth/csrf') body = { headerName: 'X-CSRF-TOKEN', token: 'test' };
    else if (path === '/auth/webauthn/credentials') body = [];
    else if (path === '/admin/alfa-config' && method === 'GET')
      body = {
        enabled: true,
        configured: false,
        candidatePresent,
        candidateStatus: candidatePresent ? 'UNVERIFIED' : null,
        updatedAt: null,
        updatedBy: null,
      };
    else if (path === '/admin/alfa-config/candidate') {
      if (failCandidate)
        return route.fulfill({
          status: 403,
          json: {
            code: 'REAUTH_REQUIRED',
            requestId: 'test',
            detail: 'Подтвердите свой пароль заново.',
            fieldErrors: {},
          },
        });
      candidatePresent = true;
      commands.push('candidate');
    } else if (path === '/admin/alfa-config/candidate/check') {
      commands.push('check');
      body = {
        enabled: true,
        configured: false,
        candidatePresent: true,
        candidateStatus: 'UNVERIFIED',
        updatedAt: null,
        updatedBy: null,
      };
    } else if (path === '/admin/payment-requests') {
      const category = url.searchParams.get('category');
      const items = category === 'ARCHIVED' ? archived : active;
      const pageNumber = Number(url.searchParams.get('page') ?? 0);
      body = { items: items.slice(pageNumber * 20, pageNumber * 20 + 20), total: items.length };
    } else if (path.startsWith('/admin/payment-requests/')) {
      const [id, operation] = path.slice('/admin/payment-requests/'.length).split('/');
      commands.push(operation);
      if (operation === 'link') body = { url: 'https://example.test/test-payment' };
      if (operation === 'archive' || operation === 'cancel') {
        const index = active.findIndex((item) => item.id === id);
        if (index >= 0) archived.unshift({ ...active.splice(index, 1)[0], archived: true });
      }
    }
    await route.fulfill({ status: 200, json: body });
  });
  return commands;
}

test('две независимые таблицы, состояние и доступные действия', async ({ page }) => {
  const commands = await fixture(page);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('admin/payments');
  const active = page.getByRole('region', { name: 'Активные оплаты' });
  const archived = page.getByRole('region', { name: 'Архивные оплаты' });
  await expect(active.getByRole('row')).toHaveCount(21);
  await expect(archived.getByRole('row')).toHaveCount(21);
  await active.getByRole('button', { name: 'Далее' }).click();
  await expect(active.getByText('Занятие 21', { exact: true })).toBeVisible();
  await expect(archived.getByText('Занятие 101', { exact: true })).toBeVisible();
  await active.getByRole('button', { name: 'Назад' }).click();
  await expect(active.getByText('Отказ в оплате')).toBeVisible();
  await expect(active.getByText('Не удалось обновить состояние в банке.')).toBeVisible();
  await expect(active.getByText('В тестовом заказе: Исходное занятие')).toBeVisible();
  await active
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: 'Занятие 2', exact: true }) })
    .getByRole('button', { name: 'В архив' })
    .click();
  await expect.poll(() => commands.includes('archive')).toBe(true);
  await expect(page.getByText('Запись перенесена в архив.')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
});

test('сотрудник только с просмотром не видит команд оплаты', async ({ page }) => {
  await fixture(page, true);
  await page.goto('admin/payments');
  await expect(page.getByRole('heading', { name: 'Активные оплаты' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Отменить платёж' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'В архив' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Показать тестовую ссылку' })).toHaveCount(0);
  await page.goto('account/security');
  await expect(page.getByRole('heading', { name: 'Тестовое подключение Альфа-Банка' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('heading', { name: 'Ключи доступа' })).toBeVisible();
});

test('тестовая ссылка и отмена доступны только как явные действия', async ({ page }) => {
  const commands = await fixture(page);
  await page.goto('admin/payments');
  const row = page.getByRole('row').filter({
    has: page.getByRole('rowheader', { name: 'Занятие 1', exact: true }),
  });
  await expect(page.getByLabel('Тестовая ссылка')).toHaveCount(0);
  await row.getByRole('button', { name: 'Показать тестовую ссылку' }).click();
  await expect(page.getByLabel('Тестовая ссылка')).toHaveValue('https://example.test/test-payment');
  await page.getByRole('button', { name: 'Скрыть ссылку' }).click();
  await expect(page.getByLabel('Тестовая ссылка')).toHaveCount(0);
  await row.getByRole('button', { name: 'Отменить платёж' }).click();
  await expect.poll(() => commands.includes('cancel')).toBe(true);
  await expect(
    page.getByRole('region', { name: 'Архивные оплаты' }).getByText('Занятие 1', { exact: true }),
  ).toBeVisible();
});

test('администратор сохраняет тестовые реквизиты без повторного показа', async ({ page }) => {
  const commands = await fixture(page);
  await page.goto('account/security');
  await page.getByLabel('Тестовый логин').fill('example-login');
  await page.getByLabel('Тестовый пароль').fill('example-password');
  await page.getByLabel('Это реквизиты тестовой среды').check();
  await page.getByRole('button', { name: 'Сохранить для проверки' }).click();
  await expect.poll(() => commands.includes('candidate')).toBe(true);
  await expect(page.getByText('Новые реквизиты ожидают проверки.')).toBeVisible();
  await expect(page.getByLabel('Тестовый пароль')).toHaveValue('');
  await expect(page.getByLabel('Тестовый логин')).toHaveValue('');
  await page.getByRole('button', { name: 'Проверить реквизиты' }).click();
  await expect(
    page.getByText(
      'Проверка пока недоступна: подтверждение банка не получено. Новые реквизиты не активированы.',
    ),
  ).toBeVisible();
});

test('ошибка подтверждения сохраняет введённые реквизиты', async ({ page }) => {
  await fixture(page, false, true);
  await page.goto('account/security');
  await page.getByLabel('Тестовый логин').fill('example-login');
  await page.getByLabel('Тестовый пароль').fill('example-password');
  await page.getByLabel('Это реквизиты тестовой среды').check();
  await page.getByRole('button', { name: 'Сохранить для проверки' }).click();
  await expect(
    page.locator('[data-page-error="true"]').filter({ hasText: 'Подтвердите свой пароль заново.' }),
  ).toBeVisible();
  await expect(page.getByLabel('Тестовый логин')).toHaveValue('example-login');
  await expect(page.getByLabel('Тестовый пароль')).toHaveValue('example-password');
});
