import { expect, test } from '@playwright/test';

for (const viewport of [
  { width: 320, height: 568 },
  { width: 1440, height: 900 },
]) {
  test(`диалог кабинета поверх закреплённых панелей на ${viewport.width} px`, async ({
    page,
    baseURL,
  }) => {
    const account = { id: 'test', login: 'test', name: 'Тест', role: 'ADMIN', roles: ['ADMIN'] };
    await page.route('**/api/v1/**', (route) => {
      const path = new URL(route.request().url()).pathname.split('/api/v1')[1];
      if (path === '/auth/me') return route.fulfill({ json: { state: 'FULL', account } });
      if (path === '/auth/password-confirmation') return route.fulfill({ json: { fresh: false } });
      if (path === '/auth/webauthn/credentials') return route.fulfill({ json: [] });
      if (path === '/admin/alfa-config')
        return route.fulfill({
          json: { enabled: false, configured: false, candidatePresent: true },
        });
      return route.fulfill({ json: {} });
    });
    await page.setViewportSize(viewport);
    await page.goto(new URL('account/security', baseURL).toString());
    const trigger = page.getByRole('button', { name: 'Проверить реквизиты' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Подтвердите пароль' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Текущий пароль', { exact: true })).toBeVisible();
    const cancel = dialog.getByRole('button', { name: 'Отмена' });
    await expect(cancel).toBeVisible();
    await cancel.scrollIntoViewIfNeeded();
    const topLayer = await cancel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return document
        .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        ?.closest('dialog')?.open;
    });
    expect(topLayer).toBe(true);
    await cancel.click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });
}
