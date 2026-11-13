import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const screenshots = '../artifacts/alfa-security-settings';

async function fixture(page: Page, options: { staff?: boolean; fail?: boolean } = {}) {
  let candidatePresent = false;
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
    else if (path === '/admin/alfa-config/candidate') {
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
    await route.fulfill({ status: 200, json: body });
  });
  return requests;
}

test('сохраняются только тестовые реквизиты, а прежние не показываются', async ({ page }) => {
  const requests = await fixture(page);
  await page.goto('account/security');
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
  await page.goto('account/security');
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
  await expect(page.getByRole('heading', { name: 'Ключи доступа' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Тестовое подключение Альфа-Банка' })).toHaveCount(
    0,
  );
});

test('расположение и управление настройками на разных экранах', async ({ page }, info) => {
  await fixture(page);
  mkdirSync(screenshots, { recursive: true });
  await page.goto('account/security');
  const region = page.getByRole('region', { name: 'Тестовое подключение Альфа-Банка' });
  await expect(region).toBeVisible();
  for (const width of [320, 375, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(region.getByText('Тестовое подключение выключено.')).toBeVisible();
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
