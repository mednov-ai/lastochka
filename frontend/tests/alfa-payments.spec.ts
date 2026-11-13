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
    availableGatewayEnvironment: 'TEST',
    gatewayEnvironment: 'TEST',
    bankStatus: archived ? 'PAID' : id === 2 || id === 21 ? 'DECLINED' : 'REGISTERED',
    operationState: archived ? 'PAID' : id === 2 || id === 21 ? 'DECLINED' : 'OPEN',
    snapshotPurpose: id === 3 ? 'Исходное занятие' : id === 4 ? 'Занятие 4' : null,
    snapshotAmountMinor: id === 3 ? 10000 : id === 4 ? 12300 : null,
    bankCheckedAt: '2026-11-06T10:00:00Z',
    bankError: id === 3 ? 'NETWORK' : null,
    archived,
    canCancel: !archived && id === 1,
    canArchive: !archived && (id === 2 || id === 21),
    canRefresh: !archived,
    linkAvailable: !archived && id === 1,
  };
}

async function fixture(
  page: Page,
  staffReadOnly = false,
  failCandidate = false,
  production = false,
  unknownEnvironment = false,
) {
  const active = Array.from({ length: 21 }, (_, index) => payment(index + 1));
  if (production) {
    active[0].gatewayEnvironment = 'PRODUCTION';
    active[0].availableGatewayEnvironment = 'PRODUCTION';
  }
  if (unknownEnvironment) {
    active[0].availableGatewayEnvironment = 'UNKNOWN';
    active[0].gatewayEnvironment = 'UNKNOWN';
  }
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
    else if (path === '/auth/password-confirmation') body = { fresh: true };
    else if (path === '/admin/alfa-production-config')
      body = {
        allowed: false,
        configured: false,
        enabled: false,
        candidatePresent: false,
        activationReady: false,
        obstacles: ['FORBIDDEN'],
        updatedAt: null,
      };
    else if (path === '/admin/alfa-gateway-selection')
      body = { activeEnvironment: null, revision: 0 };
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
        if (index >= 0) { const moved = { ...active.splice(index, 1)[0], archived: true }; archived.unshift(moved); body = moved; }
      }
    }
    await route.fulfill({
      status: 200,
      json: body,
      headers: path === '/admin/alfa-config' ? { 'X-Lastochka-Alfa-Environment': 'TEST' } : {},
    });
  });
  return commands;
}

test('две независимые таблицы, состояние и доступные действия', async ({ page }) => {
  const commands = await fixture(page);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto('admin/payments');
  await page.waitForLoadState('networkidle');
  const active = page.getByRole('region', { name: 'Активные оплаты' });
  const archived = page.getByRole('region', { name: 'Архивные оплаты' });
  await expect(active.getByRole('row')).toHaveCount(21);
  await expect(archived).toHaveCount(0);
  await active.getByRole('button', { name: 'Далее' }).click();
  await expect(active.getByText('Занятие 21', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Архивные/ }).click();
  await expect(archived.getByText('Занятие 101', { exact: true })).toBeVisible();
  await archived.getByRole('button', { name: 'Далее' }).click();
  await expect(archived.getByText('Занятие 121', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /Активные/ }).click();
  await expect(active.getByText('Занятие 21', { exact: true })).toBeVisible();
  await active.getByRole('button', { name: 'Назад' }).click();
  await expect(active.getByText('Отказ в оплате')).toBeVisible();
  await expect(active.getByText('Не удалось обновить состояние в банке.')).toBeVisible();
  await expect(active.getByText('В заказе: Исходное занятие')).toBeVisible();
  await expect(active.getByText('В заказе: Занятие 4')).toHaveCount(0);
  await expect(active.getByText(/В заказе:\s*100,00/)).toBeVisible();
  const equalSnapshot = active.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Занятие 4', exact: true }) });
  await expect(equalSnapshot.getByText(/В заказе:/)).toHaveCount(0);
  await active
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: 'Занятие 2', exact: true }) })
    .getByRole('button', { name: 'В архив' })
    .click();
  await expect.poll(() => commands.includes('archive')).toBe(true);
  await expect(page.getByText('Запись перенесена в архив.')).toBeVisible();
  await page.getByRole('button', { name: 'Открыть архив' }).click();
  await expect(page.getByRole('tab', { name: /Архивные/ })).toHaveAttribute('aria-selected', 'true');
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
  await expect(page.getByRole('textbox', { name: 'Тестовая ссылка' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Показать тестовую ссылку' }).click();
  await expect(page.getByRole('textbox', { name: 'Тестовая ссылка' })).toHaveValue('https://example.test/test-payment');
  const dialog = page.getByRole('dialog', { name: 'Тестовая ссылка' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row.getByRole('button', { name: 'Показать тестовую ссылку' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Тестовая ссылка' })).toHaveCount(0);
  await row.getByRole('button', { name: 'Отменить платёж' }).click();
  await expect.poll(() => commands.includes('cancel')).toBe(true);
  await page.getByRole('button', { name: 'Открыть архив' }).click();
  await expect(
    page.getByRole('region', { name: 'Архивные оплаты' }).getByText('Занятие 1', { exact: true }),
  ).toBeVisible();
});

test('вкладки доступны стрелками и переключение не создаёт банковских команд', async ({ page }) => {
  const commands = await fixture(page);
  await page.goto('admin/payments');
  const active = page.getByRole('tab', { name: /Активные/ });
  const archived = page.getByRole('tab', { name: /Архивные/ });
  await active.focus();
  await page.keyboard.press('ArrowRight');
  await expect(archived).toBeFocused();
  await expect(archived).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(active).toBeFocused();
  await page.keyboard.press('End');
  await expect(archived).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(active).toBeFocused();
  expect(commands).toEqual([]);
});

test('пустые вкладки и длинные значения не ломают экран', async ({ page }) => {
  await fixture(page);
  let showLong = false;
  await page.route('**/api/v1/admin/payment-requests?*', async (route) => {
    const category = new URL(route.request().url()).searchParams.get('category');
    const item = { ...payment(1), purpose: 'ОченьДлинноеНазначение'.repeat(15), recipientName: 'Получатель'.repeat(25), operationState: 'UNKNOWN' };
    await route.fulfill({ json: { items: showLong && category === 'ACTIVE' ? [item] : [], total: showLong && category === 'ACTIVE' ? 1 : 0 } });
  });
  await page.setViewportSize({ width: 320, height: 600 });
  await page.goto('admin/payments');
  await expect(page.getByText('Активных оплат пока нет.')).toBeVisible();
  await page.getByRole('tab', { name: /Архивные/ }).click();
  await expect(page.getByText('Архивных оплат пока нет.')).toBeVisible();
  showLong = true;
  await page.reload();
  await expect(page.getByText('Результат уточняется')).toBeVisible();
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test('архивирование последней записи возвращает на существующую страницу', async ({ page }) => {
  await fixture(page);
  await page.goto('admin/payments');
  await page.waitForLoadState('networkidle');
  const active = page.getByRole('region', { name: 'Активные оплаты' });
  await active.getByRole('button', { name: 'Далее' }).click();
  await active.getByRole('row').filter({ hasText: 'Занятие 21' }).getByRole('button', { name: 'В архив' }).click();
  await expect(page.getByText('Запись перенесена в архив.')).toBeVisible();
  await expect(active.getByText('Занятие 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Открыть архив' }).click();
  await expect(page.getByRole('region', { name: 'Архивные оплаты' }).getByText('Занятие 21', { exact: true })).toBeVisible();
});

test('задержавшаяся страница не заменяет более свежую', async ({ page }) => {
  await fixture(page);
  let release!: () => void;
  let started!: () => void;
  let finished!: () => void;
  const began = new Promise<void>((resolve) => { started = resolve; });
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const completed = new Promise<void>((resolve) => { finished = resolve; });
  await page.route('**/api/v1/admin/payment-requests?*', async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('category') === 'ACTIVE' && url.searchParams.get('page') === '1') {
      started(); await hold;
      await route.fulfill({ json: { items: [payment(21)], total: 21 } });
      finished();
    } else await route.fallback();
  });
  await page.goto('admin/payments');
  await page.waitForLoadState('networkidle');
  const active = page.getByRole('region', { name: 'Активные оплаты' });
  await active.getByRole('button', { name: 'Далее' }).click();
  await began;
  await active.getByRole('button', { name: 'Назад' }).click();
  await expect(active.getByText('Занятие 1', { exact: true })).toBeVisible();
  release();
  await completed;
  await expect(active.getByText('Занятие 21', { exact: true })).toHaveCount(0);
});

test('ошибка банковской команды сохраняется при смене вкладки', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/v1/admin/payment-requests/1/refresh', (route) => route.fulfill({
    status: 503, json: { code: 'BANK_UNAVAILABLE', detail: 'Банк временно недоступен.', requestId: 'fixture' },
  }));
  await page.goto('admin/payments');
  await page.waitForLoadState('networkidle');
  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Занятие 1', exact: true }) });
  await row.getByRole('button', { name: 'Проверить состояние' }).click();
  await expect(page.locator('[data-page-error="true"]')).toContainText('Банк временно недоступен.');
  await page.getByRole('tab', { name: /Архивные/ }).click();
  await expect(page.locator('[data-page-error="true"]')).toContainText('Банк временно недоступен.');
});

test('при ошибке копирования ссылка остаётся доступной вручную', async ({ page }) => {
  await fixture(page);
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', {
    configurable: true, value: { writeText: async () => { throw new Error('denied'); } },
  }));
  await page.goto('admin/payments');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Показать тестовую ссылку' }).click();
  const dialog = page.getByRole('dialog', { name: 'Тестовая ссылка' });
  await dialog.getByRole('button', { name: 'Скопировать' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Выделите и скопируйте её вручную');
  await expect(dialog.getByRole('textbox', { name: 'Тестовая ссылка' })).toHaveValue('https://example.test/test-payment');
});

test('отзыв права скрывает уже открытую ссылку', async ({ page }) => {
  await fixture(page);
  await page.goto('admin/payments');
  await page.getByRole('button', { name: 'Показать тестовую ссылку' }).click();
  await expect(page.getByRole('dialog', { name: 'Тестовая ссылка' })).toBeVisible();
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: {
    state: 'FULL', account: { id: 'self', login: 'tester', name: 'Сотрудник', role: 'STAFF', roles: ['STAFF'], permissions: ['PAYMENT_VIEW'] },
  } }));
  await page.evaluate(() => window.dispatchEvent(new Event('lastochka:auth-changed')));
  await expect(page.getByRole('dialog', { name: 'Тестовая ссылка' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Показать тестовую ссылку' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Активные/ })).toBeFocused();
});

test('смена учётной записи закрывает ссылку и не помещает её в адрес или хранилище', async ({ page }) => {
  await fixture(page);
  await page.goto('admin/payments');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Показать тестовую ссылку' }).click();
  await expect(page.getByRole('dialog', { name: 'Тестовая ссылка' })).toBeVisible();
  const exposed = await page.evaluate(() => [location.href, JSON.stringify(localStorage), JSON.stringify(sessionStorage)].join(' '));
  expect(exposed).not.toContain('https://example.test/test-payment');
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: {
    state: 'FULL', account: { id: 'other', login: 'other', name: 'Другой администратор', role: 'ADMIN', roles: ['ADMIN'], permissions: [] },
  } }));
  await page.evaluate(() => window.dispatchEvent(new Event('lastochka:auth-changed')));
  await expect(page.getByRole('dialog', { name: 'Тестовая ссылка' })).toHaveCount(0);
});

test('поздний ответ ссылки не раскрывается после отзыва права', async ({ page }) => {
  await fixture(page);
  let release!: () => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => { started = resolve; });
  const hold = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/admin/payment-requests/1/link', async (route) => {
    started(); await hold; await route.fulfill({ json: { url: 'https://example.test/test-payment' } });
  });
  await page.goto('admin/payments');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Показать тестовую ссылку' }).click();
  await began;
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: {
    state: 'FULL', account: { id: 'self', login: 'tester', name: 'Сотрудник', role: 'STAFF', roles: ['STAFF'], permissions: ['PAYMENT_VIEW'] },
  } }));
  await page.evaluate(() => window.dispatchEvent(new Event('lastochka:auth-changed')));
  await expect(page.getByRole('button', { name: 'Показать тестовую ссылку' })).toHaveCount(0);
  release();
  await expect(page.getByRole('dialog', { name: 'Тестовая ссылка' })).toHaveCount(0);
});

test('администратор сохраняет тестовые реквизиты без повторного показа', async ({ page }) => {
  const commands = await fixture(page);
  await page.goto('admin/integrations');
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
      'Состояние реквизитов обновлено. Если проверка не подтверждена, действующее подключение не изменено.',
    ),
  ).toBeVisible();
});

test('ошибка подтверждения сохраняет введённые реквизиты', async ({ page }) => {
  await fixture(page, false, true);
  await page.goto('admin/integrations');
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

test('боевая ссылка и статус не называются тестовыми', async ({ page }) => {
  await fixture(page, false, false, true);
  await page.goto('admin/payments');
  await page.waitForLoadState('networkidle');
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: 'Занятие 1', exact: true }) });
  await expect(row.getByText('Реальная оплата')).toBeVisible();
  await expect(row.getByText('Тестовая оплата')).toHaveCount(0);
  await row.getByRole('button', { name: 'Показать ссылку на оплату' }).click();
  await expect(page.getByRole('textbox', { name: 'Ссылка для реальной оплаты' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Тестовая ссылка' })).toHaveCount(0);
});

test('создание реальной ссылки требует явного подтверждения', async ({ page }) => {
  const commands = await fixture(page, false, false, true);
  await page.addInitScript(() => {
    let accepted = false;
    window.confirm = () => accepted;
    window.addEventListener('test-confirm-accept', () => { accepted = true; });
  });
  await page.goto('admin/payments');
  const row = page.getByRole('row').filter({
    has: page.getByRole('rowheader', { name: 'Занятие 1', exact: true }),
  });
  await row.getByRole('button', { name: 'Создать ссылку на оплату', exact: true }).click();
  expect(commands).not.toContain('issue');
  await page.evaluate(() => window.dispatchEvent(new Event('test-confirm-accept')));
  await row.getByRole('button', { name: 'Создать ссылку на оплату', exact: true }).click();
  await expect.poll(() => commands.includes('issue')).toBe(true);
});

test('неизвестная среда не выдаётся за тестовую и блокирует ссылки', async ({ page }) => {
  const commands = await fixture(page, false, false, false, true);
  await page.goto('admin/payments');
  const row = page.getByRole('row').filter({
    has: page.getByRole('rowheader', { name: 'Занятие 1', exact: true }),
  });
  await expect(row.getByRole('button', { name: /создать.*ссылку/i })).toHaveCount(0);
  await expect(row.getByRole('button', { name: /показать.*ссылку/i })).toHaveCount(0);
  expect(commands).toEqual([]);
});
