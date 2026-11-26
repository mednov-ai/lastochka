import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const screenshots = '../artifacts/alfa-security-settings';

async function fixture(
  page: Page,
  options: {
    staff?: boolean;
    fail?: boolean;
    environment?: 'TEST' | 'PRODUCTION' | 'UNKNOWN' | 'MISSING';
    productionAllowed?: boolean;
    configured?: boolean;
    enabled?: boolean;
    candidatePresent?: boolean;
    fresh?: boolean;
  } = {},
) {
  let candidatePresent = options.candidatePresent ?? false;
  let productionCandidatePresent = false;
  const requests: unknown[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.split('/api/v1')[1];
    let body: unknown = {};
    if (path === '/auth/me') {
      const role = options.staff ? 'STAFF' : 'ADMIN';
      body = {
        state: 'FULL',
        account: {
          id: 'fixture',
          login: 'fixture',
          name: 'Сотрудник',
          role,
          roles: [role],
          permissions: [],
        },
      };
    } else if (path === '/auth/webauthn/credentials') body = [];
    else if (path === '/auth/password-confirmation') body = { fresh: options.fresh ?? true };
    else if (path === '/auth/csrf') body = { headerName: 'X-CSRF-TOKEN', token: 'fixture' };
    else if (path === '/admin/alfa-config')
      body = {
        enabled: options.enabled ?? false,
        configured: options.configured ?? false,
        candidatePresent,
        candidateStatus: candidatePresent ? 'UNVERIFIED' : null,
        updatedAt: null,
      };
    else if (path === '/admin/alfa-production-config')
      body = {
        allowed: options.productionAllowed ?? false,
        configured: false,
        enabled: false,
        candidatePresent: productionCandidatePresent,
        activationReady: false,
        obstacles: options.productionAllowed ? ['FISCALIZATION_UNCONFIRMED'] : ['FORBIDDEN'],
        updatedAt: null,
      };
    else if (path === '/admin/alfa-gateway-selection') {
      if (request.method() !== 'GET') requests.push(request.postDataJSON());
      body = { activeEnvironment: null, revision: 0 };
    } else if (path === '/admin/alfa-production-config/candidate') {
      requests.push(request.postDataJSON());
      productionCandidatePresent = true;
    } else if (path === '/admin/alfa-config/candidate') {
      requests.push(request.postDataJSON());
      if (options.fail)
        return route.fulfill({
          status: 400,
          json: {
            code: 'INVALID',
            detail: 'Проверьте реквизиты.',
            requestId: 'fixture',
            fieldErrors: {},
          },
        });
      candidatePresent = true;
    }
    const environment = options.environment ?? 'TEST';
    const headers: Record<string, string> =
      path === '/admin/alfa-config' && environment !== 'MISSING'
        ? { 'X-Lastochka-Alfa-Environment': environment }
        : {};
    await route.fulfill({ status: 200, json: body, headers });
  });
  return requests;
}

test('сохраняются только тестовые реквизиты, а прежние не показываются', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('admin/integrations');
  const login = page.getByLabel('Тестовый логин');
  const password = page.getByLabel('Тестовый пароль');
  await expect(login).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  for (const field of [login, password]) {
    await expect(field).toHaveValue('');
    await expect(field).toHaveJSProperty('placeholder', '');
  }
  await expect(page.getByText('Логин магазина для отмены')).toHaveCount(0);
  await login.fill('fixture-login');
  await password.fill('fixture-password');
  await page.getByRole('button', { name: 'Сохранить для проверки' }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({
    login: 'fixture-login',
    password: 'fixture-password',
    testConfirmed: true,
  });
  await expect(page.getByText('Новые реквизиты ожидают проверки.')).toBeVisible();
  for (const field of [login, password]) {
    await expect(field).toHaveValue('');
    await expect(field).toHaveAttribute('placeholder', '••••••••');
  }
});

for (const enabled of [true, false]) {
  test(`замена сохранённой пары при ${enabled ? 'включённом' : 'отключённом'} подключении`, async ({ page }) => {
    const requests = await fixture(page, { configured: true, enabled });
    await page.goto('admin/integrations?gateway=test');
    const login = page.getByLabel('Тестовый логин');
    const password = page.getByLabel('Тестовый пароль');
    const save = page.getByRole('button', { name: 'Сохранить для проверки' });
    for (const field of [login, password]) {
      await expect(field).toHaveAttribute('placeholder', '••••••••');
      await expect(field).toHaveValue('');
      await expect(field).toHaveAccessibleDescription('Логин и пароль сохранены. Чтобы заменить их, введите оба значения.');
    }
    await save.click();
    await expect(login).toHaveAttribute('aria-invalid', 'true');
    await login.fill('new-login');
    await save.click();
    await expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(requests).toHaveLength(0);
    await password.fill('new-password');
    await save.click();
    await expect(page.getByText('Новые реквизиты ожидают проверки.')).toBeVisible();
    expect(requests).toEqual([{ login: 'new-login', password: 'new-password', testConfirmed: true }]);
  });
}

for (const configured of [false, true]) {
  for (const candidatePresent of [false, true]) {
    test(`действия проверки для сохранённой пары ${configured} и новой пары ${candidatePresent}`, async ({ page }) => {
      await fixture(page, { configured, candidatePresent });
      await page.goto('admin/integrations');
      await expect(page.getByLabel('Тестовый логин')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Проверить подключение' })).toHaveCount(configured ? 1 : 0);
      await expect(page.getByRole('button', { name: 'Проверить новые реквизиты' })).toHaveCount(candidatePresent ? 1 : 0);
    });
  }
}

test('проверка подключения сохраняет черновик и показывает результат текущей попытки', async ({ page }) => {
  await fixture(page, { configured: true, candidatePresent: true });
  const calls: (string | null)[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const outcomes = ['CONFIRMED', 'BANK_UNAVAILABLE', 'UNCONFIRMED', 'NOT_CONFIGURED', 'SETTINGS_CHANGED'];
  await page.route('**/alfa-config/connection/check', async route => {
    expect(route.request().method()).toBe('POST');
    calls.push(route.request().postData());
    await pending;
    await route.fulfill({ json: { outcome: outcomes[calls.length - 1], checkedAt: '2026-11-26T15:20:00Z' } });
  });
  await page.goto('admin/integrations');
  const login = page.getByLabel('Тестовый логин');
  await login.fill('черновик');
  const button = page.getByRole('button', { name: 'Проверить подключение' });
  await button.focus();
  await page.keyboard.press('Enter');
  const status = page.getByRole('status').filter({ hasText: 'Проверяем подключение' });
  await expect(status).toBeVisible();
  await expect(button).toBeDisabled();
  await button.evaluate((element: HTMLButtonElement) => element.click());
  release();
  const result = page.getByRole('status').filter({ hasText: 'Подключение подтверждено.' });
  await expect(result.locator('time')).toContainText('18:20 МСК');
  const hint = page.getByText('Для изменения настроек может потребоваться подтверждение пароля.');
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const triggerBox = (await button.boundingBox())!;
    const resultBox = (await result.boundingBox())!;
    const hintBox = (await hint.boundingBox())!;
    expect(resultBox.y - triggerBox.y - triggerBox.height).toBeGreaterThanOrEqual(10);
    expect(hintBox.y - resultBox.y - resultBox.height).toBeGreaterThanOrEqual(16);
  }
  expect(calls).toEqual([null]);
  for (const text of ['Не удалось получить ответ', 'Не удалось подтвердить доступ', 'Проверка недоступна', 'Настройки изменились']) {
    await button.click();
    await expect(page.getByRole('status').filter({ hasText: text })).toBeVisible();
    await expect(page.getByText('Подключение подтверждено.', { exact: false })).toHaveCount(0);
  }
  await expect(login).toHaveValue('черновик');
  await expect(page.getByRole('button', { name: 'Проверить новые реквизиты' })).toBeEnabled();
});

test('отмена подтверждения для сохранённой пары не вызывает проверку', async ({ page }) => {
  await fixture(page, { configured: true, fresh: false });
  let checks = 0;
  page.on('request', request => { if (request.url().endsWith('/connection/check')) checks++; });
  await page.goto('admin/integrations');
  const button = page.getByRole('button', { name: 'Проверить подключение' });
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Подтвердите пароль' });
  await expect(dialog).toContainText('проверить подключение к тестовому банку');
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(button).toBeEnabled();
  await expect(button).toBeFocused();
  expect(checks).toBe(0);
});

test('смена вкладки во время проверки отбрасывает результат', async ({ page }) => {
  await fixture(page, { configured: true });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/alfa-config/connection/check', async route => {
    await pending;
    await route.fulfill({ json: { outcome: 'CONFIRMED', checkedAt: '2026-11-26T15:20:00Z' } });
  });
  await page.goto('admin/integrations');
  const check = page.getByRole('button', { name: 'Проверить подключение' });
  const started = page.waitForRequest('**/alfa-config/connection/check');
  await check.click();
  await started;
  await page.getByRole('button', { name: 'Боевой шлюз', exact: true }).click();
  await expect(page.getByText(/Боевой шлюз запрещён настройками/)).toBeVisible();
  release();
  await page.getByRole('button', { name: 'Тестовый шлюз', exact: true }).click();
  await expect(check).toBeEnabled();
  await expect(page.getByText('Подключение подтверждено.', { exact: false })).toHaveCount(0);
});

test('ошибка сохраняет ввод, сотрудник не видит банковскую настройку', async ({ page }) => {
  await fixture(page, { fail: true });
  await page.goto('admin/integrations');
  await page.getByLabel('Тестовый логин').fill('fixture-login');
  await page.getByLabel('Тестовый пароль').fill('fixture-password');
  await page.getByRole('button', { name: 'Сохранить для проверки' }).click();
  await expect(page.locator('.alfa-settings [role="alert"]')).toContainText('Проверьте реквизиты');
  await expect(page.getByLabel('Тестовый логин')).toHaveValue('fixture-login');
  await expect(page.getByLabel('Тестовый пароль')).toHaveValue('fixture-password');
  await page.unrouteAll({ behavior: 'wait' });
  await fixture(page, { staff: true });
  await page.reload();
  await expect(page.getByText('Настройки интеграций доступны администратору.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Альфа-Банк' })).toHaveCount(0);
});

test('расположение и управление настройками на разных экранах', async ({ page }, info) => {
  await fixture(page);
  mkdirSync(screenshots, { recursive: true });
  await page.goto('admin/integrations');
  const region = page.getByRole('region', { name: 'Альфа-Банк' });
  await expect(region).toBeVisible();
  for (const width of [320, 375, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(region.getByText('Проверенные реквизиты не настроены.')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    for (const control of await region
      .locator('button:visible, label:has(input[type="checkbox"])')
      .all()) {
      const box = await control.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await region.screenshot({ path: `${screenshots}/${info.project.name}-${width}.png` });
  }
  await page.addStyleTag({ content: 'html { font-size: 200% }' });
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.getByLabel('Тестовый логин').focus();
  await expect(page.getByLabel('Тестовый логин')).toBeFocused();
  for (const control of [
    page.getByLabel('Тестовый логин'),
    page.getByLabel('Тестовый пароль'),
    page.getByRole('button', { name: 'Сохранить для проверки' }),
  ]) {
    await control.focus();
    await expect
      .poll(() =>
        control.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const point = document.elementFromPoint(
            box.left + box.width / 2,
            box.top + box.height / 2,
          );
          return point === element || element.contains(point);
        }),
      )
      .toBe(true);
  }
});

for (const environment of ['PRODUCTION', 'UNKNOWN', 'MISSING'] as const) {
  test(`неизвестный признак ${environment} блокирует тестовую форму`, async ({ page }) => {
    const requests = await fixture(page, { environment });
    await page.goto('admin/integrations');
    const region = page.getByRole('region', { name: 'Альфа-Банк' });
    await expect(region.getByText(/Не удалось определить тестовую среду/)).toBeVisible();
    await expect(region.getByLabel('Тестовый логин')).toHaveCount(0);
    expect(requests).toHaveLength(0);
  });
}

test('вкладка не меняет активную среду и сохраняет ввод, боевой шлюз на test запрещён', async ({
  page,
}) => {
  const requests = await fixture(page);
  await page.goto('admin/integrations');
  await page.getByLabel('Тестовый логин').fill('fixture-login');
  await page.getByRole('button', { name: 'Боевой шлюз', exact: true }).click();
  await expect(
    page.getByText('Боевой шлюз запрещён настройками этого сайта.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel('Боевой логин')).toHaveCount(0);
  await page.getByRole('button', { name: 'Тестовый шлюз', exact: true }).click();
  await expect(page.getByLabel('Тестовый логин')).toHaveValue('fixture-login');
  await expect(page.locator('.alfa-active-mode')).toContainText('Не выбран');
  expect(requests).toHaveLength(0);
});

test('разрешённый просмотр боевых настроек не включает реальные платежи', async ({ page }) => {
  const requests = await fixture(page, { productionAllowed: true });
  await page.goto('admin/integrations?gateway=production');
  await expect(page.getByLabel('Боевой логин')).toBeVisible();
  await expect(page.getByText(/Готовность фискализации пока не подтверждена/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Выбрать боевой шлюз для новых платежей' }),
  ).toBeDisabled();
  await expect(page.locator('.alfa-active-mode')).toContainText('Не выбран');
  expect(requests).toHaveLength(0);
});

test('выбранная вкладка сохраняется при обновлении и не отправляет команд', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('admin/integrations');
  await page.getByRole('button', { name: 'Боевой шлюз', exact: true }).click();
  await expect(page).toHaveURL(/gateway=production/);
  await page.reload();
  await expect(page.getByText('Боевой шлюз запрещён настройками этого сайта.', { exact: false })).toBeVisible();
  expect(requests).toHaveLength(0);
});

test('переход из интеграций предупреждает о несохранённых реквизитах', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('admin/integrations');
  await page.getByLabel('Тестовый логин').fill('fixture-login');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('link', { name: 'Безопасность', exact: true }).click();
  await expect(page.getByLabel('Тестовый логин')).toHaveValue('fixture-login');
  await expect(page).toHaveURL(/admin\/integrations/);
  expect(requests).toHaveLength(0);
});

test('поля остаются доступными в коротком окне', async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 320, height: 480 });
  await page.goto('admin/integrations');
  for (const control of [page.getByLabel('Тестовый логин'), page.getByLabel('Тестовый пароль'),
    page.getByRole('button', { name: 'Сохранить для проверки' })]) {
    await control.focus();
    await expect(control).toBeFocused();
    await expect.poll(() => control.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const point = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return point === element || element.contains(point);
    })).toBe(true);
  }
});

test('боевые и тестовые реквизиты вводятся независимо без выбора шлюза', async ({ page }) => {
  const requests = await fixture(page, { productionAllowed: true });
  await page.goto('admin/integrations');
  await page.getByLabel('Тестовый логин').fill('test-fixture');
  await page.getByRole('button', { name: 'Боевой шлюз', exact: true }).click();
  await page.getByLabel('Боевой логин').fill('prod-fixture');
  await page.getByLabel('Боевой пароль').fill('prod-fixture-password');
  await page.getByRole('button', { name: 'Сохранить для проверки' }).click();
  await expect(page.getByLabel('Это боевые реквизиты')).toHaveAttribute('aria-invalid', 'true');
  expect(requests).toHaveLength(0);
  await page.getByLabel('Это боевые реквизиты').check();
  await page.getByRole('button', { name: 'Сохранить для проверки' }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({ login: 'prod-fixture', password: 'prod-fixture-password', productionConfirmed: true });
  await expect(page.getByText('Новые реквизиты ожидают проверки.')).toBeVisible();
  await expect(page.locator('.alfa-active-mode')).toContainText('Не выбран');
  await page.getByRole('button', { name: 'Тестовый шлюз', exact: true }).click();
  await expect(page.getByLabel('Тестовый логин')).toHaveValue('test-fixture');
});
