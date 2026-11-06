import { expect, test, type Page } from '@playwright/test';

const payment = {
  id: '00000000-0000-0000-0000-000000000008',
  amountMinor: 12500,
  purpose: 'Проверка оплаты',
  recipientName: 'Родитель',
  phone: '+79001234567',
  enquiryId: null,
  version: 0,
  status: 'DRAFT',
  currency: 'RUB',
  createdAt: '2026-01-01T00:00:00Z',
  paymentLinkIssuanceAvailable: false,
};

async function fixture(page: Page, role: 'ADMIN' | 'STAFF', getPermissions: () => string[]) {
  let posted: unknown;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.split('/api/v1')[1];
    const method = request.method();
    let body: unknown = {};
    if (path === '/auth/me')
      body = {
        state: 'FULL',
        account: {
          id: 'self',
          login: 'test',
          name: 'Сотрудник',
          role,
          roles: [role],
          permissions: getPermissions(),
        },
      };
    else if (path === '/auth/csrf')
      body = { headerName: 'X-CSRF-TOKEN', parameterName: '_csrf', token: 'test' };
    else if (path === '/admin/calendar') body = { items: [] };
    else if (path === '/admin/session-series/calendar')
      body = { memberships: [], drafts: [], warnings: [] };
    else if (path === '/admin/schedule-groups') body = { items: [] };
    else if (path === '/admin/payment-requests') body = { items: [payment], total: 1 };
    else if (path === '/admin/enquiries') body = { items: [], total: 0 };
    else if (path === '/auth/webauthn/credentials') body = [];
    else if (path === '/admin/users' && method === 'GET')
      body = { items: [], page: 0, size: 25, total: 0 };
    else if (path === '/admin/users' && method === 'POST') {
      posted = request.postDataJSON();
      body = { id: 'created' };
    }
    await route.fulfill({ status: 200, json: body });
  });
  return () => posted;
}

test('сотрудник видит разрешённые разделы без действий изменения', async ({ page }) => {
  await fixture(page, 'STAFF', () => ['SCHEDULE_VIEW', 'PAYMENT_VIEW']);
  await page.goto('admin/schedule');
  await expect(page.getByRole('heading', { name: 'Расписание', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать занятие', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Заявки', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Пользователи', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Оплата', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Создать черновик оплаты' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Просмотреть', exact: true }).click();
  await expect(page.getByText('Проверка оплаты').last()).toBeVisible();
  await expect(page.locator('dialog input')).toHaveCount(0);
  await page.goto('admin/users');
  await expect(page.getByText('У вас нет доступа к управлению пользователями.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить пользователя' })).toHaveCount(0);
});

test('отзыв просмотра закрывает открытые данные', async ({ page }) => {
  let permissions = ['PAYMENT_VIEW'];
  await fixture(page, 'STAFF', () => permissions);
  await page.goto('admin/payments');
  await page.getByRole('button', { name: 'Просмотреть', exact: true }).click();
  await expect(page.locator('dialog').getByText('Проверка оплаты')).toBeVisible();
  permissions = [];
  await page.evaluate(() => window.dispatchEvent(new Event('lastochka:session-expired')));
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(
    page.getByText('У вас нет доступа к этому разделу.', { exact: false }),
  ).toBeVisible();
});

test('администратор назначает права и изменение включает просмотр', async ({ page }) => {
  const posted = await fixture(page, 'ADMIN', () => []);
  await page.goto('admin/users');
  await page.getByRole('button', { name: 'Добавить пользователя' }).click();
  await page.getByLabel('Имя', { exact: true }).fill('Новый сотрудник');
  await page.getByLabel('Логин', { exact: true }).fill('employee');
  await page.getByRole('combobox', { name: 'Роль' }).selectOption('STAFF');
  await page.getByLabel('Изменение расписания').check();
  await expect(page.getByLabel('Просмотр расписания')).toBeChecked();
  await page.getByLabel('Временный пароль', { exact: true }).fill('Test-pass-2026');
  await page.getByRole('button', { name: 'Создать сотрудника' }).click();
  await expect
    .poll(posted)
    .toMatchObject({ role: 'STAFF', permissions: ['SCHEDULE_EDIT', 'SCHEDULE_VIEW'] });
});

test('конфликт версии и защита последнего администратора сохраняют форму', async ({ page }) => {
  await fixture(page, 'ADMIN', () => []);
  await page.route('**/api/v1/admin/users?page=0&size=25', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'owner',
            name: 'Администратор',
            login: 'owner',
            role: 'ADMIN',
            permissions: [],
            revision: 0,
            accessRevision: 0,
            mustChangePassword: false,
          },
        ],
        page: 0,
        size: 25,
        total: 1,
      },
    }),
  );
  let code = 'VERSION_CONFLICT';
  await page.route('**/api/v1/admin/users/owner/access', (route) =>
    route.fulfill({
      status: 409,
      json: {
        code,
        detail:
          code === 'VERSION_CONFLICT' ? 'Данные изменились.' : 'Нужен хотя бы один администратор.',
      },
    }),
  );
  await page.goto('admin/users');
  await page.getByRole('button', { name: 'Изменить права' }).click();
  await page.getByRole('combobox', { name: 'Роль' }).selectOption('STAFF');
  await page.getByLabel('Просмотр оплат').check();
  await page.getByRole('button', { name: 'Сохранить права' }).click();
  await expect(page.locator('#main').getByRole('alert')).toContainText('Данные изменились');
  await expect(page.getByLabel('Просмотр оплат')).toBeChecked();
  code = 'LAST_ADMIN_REQUIRED';
  await page.getByRole('button', { name: 'Сохранить права' }).click();
  await expect(page.locator('#main').getByRole('alert')).toContainText(
    'Должен оставаться хотя бы один администратор',
  );
  await expect(page.getByLabel('Просмотр оплат')).toBeChecked();
});

test('создание оплаты из заявки зависит от права изменения оплат', async ({ page }) => {
  let permissions = ['ENQUIRIES_VIEW'];
  await fixture(page, 'STAFF', () => permissions);
  const enquiry = {
    id: 'enquiry',
    number: 1,
    parentName: 'Родитель',
    phone: '+79001234567',
    createdAt: '2026-01-01T00:00:00Z',
  };
  await page.route('**/api/v1/admin/enquiries?page=0', (route) =>
    route.fulfill({ json: { items: [enquiry], total: 1 } }),
  );
  await page.goto('admin/requests');
  await page.getByRole('button', { name: 'Открыть заявку' }).click();
  await expect(page.getByRole('button', { name: 'Подготовить оплату' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Закрыть панель' }).click();
  permissions = ['ENQUIRIES_VIEW', 'PAYMENT_VIEW', 'PAYMENT_EDIT'];
  await page.evaluate(() => window.dispatchEvent(new Event('lastochka:session-expired')));
  await expect(page.getByRole('link', { name: 'Оплата', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Открыть заявку' }).click();
  await page.getByRole('button', { name: 'Подготовить оплату' }).click();
  await expect(page.getByLabel('Имя получателя', { exact: true })).toHaveValue('Родитель');
});

test('отзыв доступа сохраняет незавершённый ввод до решения сотрудника', async ({ page }) => {
  let permissions = ['PAYMENT_VIEW', 'PAYMENT_EDIT'];
  await fixture(page, 'STAFF', () => permissions);
  const otherTab = await page.context().newPage();
  await fixture(otherTab, 'STAFF', () => permissions);
  let writes = 0;
  for (const tab of [page, otherTab]) {
    tab.on('request', (request) => {
      if (request.method() !== 'GET' && request.url().includes('/admin/payment-requests')) writes++;
    });
  }
  await page.goto('admin/payments');
  await otherTab.goto('admin/payments');
  await page.getByRole('button', { name: 'Создать черновик оплаты' }).click();
  const purpose = page.getByLabel('Назначение', { exact: true });
  await purpose.fill('Несохранённый ввод');
  permissions = ['PAYMENT_VIEW'];
  await page.evaluate(() => window.dispatchEvent(new Event('lastochka:session-expired')));
  await otherTab.evaluate(() => window.dispatchEvent(new Event('lastochka:session-expired')));
  await expect(page.getByText('Доступ на изменение отозван.', { exact: false })).toBeVisible();
  await expect(otherTab.getByRole('button', { name: 'Создать черновик оплаты' })).toHaveCount(0);
  await expect(purpose).toHaveValue('Несохранённый ввод');
  await expect(purpose).toBeDisabled();
  await page.getByRole('button', { name: 'Закрыть панель' }).click();
  await expect(page.getByText('Закрыть форму и отбросить несохранённый ввод?')).toBeVisible();
  await page.getByRole('button', { name: 'Остаться', exact: true }).click();
  await expect(purpose).toHaveValue('Несохранённый ввод');
  await page.getByRole('button', { name: 'Закрыть панель' }).click();
  await page.getByRole('button', { name: 'Выйти без сохранения' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(writes).toBe(0);
  await otherTab.close();
});

test('начатая команда завершается один раз при отзыве прав', async ({ page }) => {
  let permissions = ['PAYMENT_VIEW', 'PAYMENT_EDIT'];
  await fixture(page, 'STAFF', () => permissions);
  let finish!: () => void;
  const responseAllowed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let writes = 0;
  await page.route('**/api/v1/admin/payment-requests', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { items: [payment], total: 1 } });
    writes++;
    await responseAllowed;
    return route.fulfill({ json: payment });
  });
  await page.goto('admin/payments');
  await page.getByRole('button', { name: 'Создать черновик оплаты' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Сумма в рублях').fill('100');
  await dialog.getByLabel('Назначение').fill('Занятие');
  await dialog.getByLabel('Имя получателя').fill('Родитель');
  await dialog.getByLabel('Телефон', { exact: true }).fill('9001234567');
  await dialog.getByRole('button', { name: 'Сохранить черновик' }).click();
  await expect.poll(() => writes).toBe(1);
  permissions = ['PAYMENT_VIEW'];
  await page.evaluate(() => window.dispatchEvent(new Event('lastochka:session-expired')));
  await expect(page.getByText('Доступ на изменение отозван.', { exact: false })).toBeVisible();
  finish();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.getByText('Черновик оплаты сохранён.')).toBeVisible();
  expect(writes).toBe(1);
});

test('выбор прав доступен на узком экране и при увеличении текста', async ({ browser }) => {
  for (const locale of ['ru-RU', 'en-US']) {
    const context = await browser.newContext({ locale, viewport: { width: 320, height: 680 } });
    const page = await context.newPage();
    try {
      await fixture(page, 'ADMIN', () => []);
      await page.goto('admin/users');
      await page.getByRole('button', { name: 'Добавить пользователя' }).click();
      await page.getByRole('combobox', { name: 'Роль' }).selectOption('STAFF');
      for (const width of [320, 375, 768, 1440]) {
        await page.setViewportSize({ width, height: 680 });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
        ).toBeLessThanOrEqual(1);
      }
      await page.addStyleTag({ content: 'html { font-size: 200% }' });
      await page.setViewportSize({ width: 320, height: 680 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
      await page.getByLabel('Изменение оплат').focus();
      await expect(page.getByLabel('Изменение оплат')).toBeFocused();
      await page.keyboard.press('Space');
      await expect(page.getByLabel('Просмотр оплат')).toBeChecked();
    } finally {
      await context.close();
    }
  }
});
