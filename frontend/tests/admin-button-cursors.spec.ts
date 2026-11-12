import { expect, test, type Page } from '@playwright/test';

const account = {
  id: 'self',
  login: 'admin',
  name: 'Администратор',
  role: 'ADMIN',
  roles: ['ADMIN'],
};

async function mock(page: Page, onCheck: () => Promise<void>) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.split('/api/v1')[1];
    let body: unknown = {};
    if (path === '/auth/me') body = { state: 'FULL', account };
    else if (path === '/auth/csrf') body = { headerName: 'X-CSRF-TOKEN', token: 'test' };
    else if (path === '/auth/webauthn/credentials') body = [];
    else if (path === '/admin/alfa-config')
      body = { enabled: false, configured: false, candidatePresent: true, updatedAt: null };
    else if (path === '/admin/alfa-config/candidate/check') {
      await onCheck();
      return route.fulfill({ status: 500, json: { code: 'TEST', detail: 'Ошибка проверки.' } });
    } else if (path === '/admin/payment-requests')
      body = { items: [], total: 0, page: 0, size: 20 };
    else if (path === '/admin/users') body = { items: [account], total: 1, page: 0, size: 25 };
    await route.fulfill({ json: body });
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 375, height: 812 },
]) {
  test(`кнопки и ожидание при ширине ${viewport.width}`, async ({ page }) => {
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    await mock(page, async () => {
      calls++;
      await pending;
    });
    await page.setViewportSize(viewport);
    await page.goto('account/security');
    const check = page.getByRole('button', { name: 'Проверить реквизиты' });
    const disable = page.getByRole('button', { name: 'Отключить подключение' });
    await expect(check).toBeEnabled();
    await expect(check).toHaveCSS('cursor', 'pointer');
    await page.getByLabel('Тестовый логин').fill('пример');
    await check.focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('status').filter({ hasText: 'Выполняем действие с настройками подключения' }),
    ).toBeVisible();
    await expect(check).toBeDisabled();
    await expect(disable).toBeDisabled();
    await expect.poll(() => calls).toBe(1);
    await check.evaluate((button: HTMLButtonElement) => button.click());
    expect(calls).toBe(1);
    release();
    await expect(page.locator('.alfa-settings [data-page-error="true"]')).toBeVisible();
    await expect(page.getByLabel('Тестовый логин')).toHaveValue('пример');
    await expect(check).toBeEnabled();
    await expect(page.getByText('Выполняем действие с настройками подключения…')).toHaveCount(0);
    await page.goto('admin/payments');
    await page.getByRole('button', { name: 'Создать черновик оплаты' }).click();
    const link = page.getByRole('dialog').getByRole('button', { name: 'Создать платёжную ссылку' });
    await expect(link).toBeDisabled();
    await expect(link).toHaveCSS('cursor', 'default');
    await page.goto('admin/users');
    const back = page
      .getByRole('navigation', { name: 'Страницы пользователей' })
      .getByRole('button', { name: 'Назад' });
    await expect(back).toBeDisabled();
    await expect(back).toHaveCSS('cursor', 'default');
  });
}
