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
  } = {},
) {
  let candidatePresent = false;
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
    else if (path === '/auth/password-confirmation') body = { fresh: true };
    else if (path === '/auth/csrf') body = { headerName: 'X-CSRF-TOKEN', token: 'fixture' };
    else if (path === '/admin/alfa-config')
      body = {
        enabled: false,
        configured: false,
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
  await expect(page.getByText('Логин магазина для отмены')).toHaveCount(0);
  await page.getByLabel('Тестовый логин').fill('fixture-login');
  await page.getByLabel('Тестовый пароль').fill('fixture-password');
  await page.getByLabel('Это реквизиты тестовой среды').check();
  await page.getByRole('button', { name: 'Сохранить для проверки' }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({
    login: 'fixture-login',
    password: 'fixture-password',
    testConfirmed: true,
  });
  await expect(page.getByText('Новые реквизиты ожидают проверки.')).toBeVisible();
  await expect(page.getByLabel('Тестовый логин')).toHaveValue('');
  await expect(page.getByLabel('Тестовый пароль')).toHaveValue('');
});

test('ошибка сохраняет ввод, сотрудник не видит банковскую настройку', async ({ page }) => {
  await fixture(page, { fail: true });
  await page.goto('admin/integrations');
  await page.getByLabel('Тестовый логин').fill('fixture-login');
  await page.getByLabel('Тестовый пароль').fill('fixture-password');
  await page.getByLabel('Это реквизиты тестовой среды').check();
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
    page.getByLabel('Это реквизиты тестовой среды'),
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
  await page.getByLabel('Это боевые реквизиты').check();
  await page.getByRole('button', { name: 'Сохранить для проверки' }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({ login: 'prod-fixture', password: 'prod-fixture-password', productionConfirmed: true });
  await expect(page.getByText('Новые реквизиты ожидают проверки.')).toBeVisible();
  await expect(page.locator('.alfa-active-mode')).toContainText('Не выбран');
  await page.getByRole('button', { name: 'Тестовый шлюз', exact: true }).click();
  await expect(page.getByLabel('Тестовый логин')).toHaveValue('test-fixture');
});
