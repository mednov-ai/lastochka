import { expect, test, type Page } from '@playwright/test';

async function fixture(
  page: Page,
  options: {
    fresh?: boolean;
    staleCommand?: boolean;
    lostCommand?: boolean;
    oldBackend?: boolean;
    emptyKeys?: boolean;
    confirmationFailure?: 'rate' | 'network' | 'csrf';
    delayConfirm?: boolean;
  } = {},
) {
  let fresh = options.fresh ?? false;
  const calls: string[] = [];
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
          login: 'admin',
          name: 'Администратор',
          role: 'ADMIN',
          roles: ['ADMIN'],
          permissions: [],
        },
      };
    else if (path === '/auth/csrf') body = { headerName: 'X-CSRF-TOKEN', token: 'fixture' };
    else if (path === '/auth/password-confirmation' && method === 'GET') {
      if (options.oldBackend) return route.fulfill({ status: 404, json: { code: 'NOT_FOUND' } });
      body = { fresh };
    } else if (path === '/auth/password-confirmation' && method === 'POST') {
      calls.push('confirm');
      if (options.delayConfirm) await new Promise((resolve) => setTimeout(resolve, 500));
      if (options.confirmationFailure === 'network') return route.abort('failed');
      if (options.confirmationFailure === 'csrf')
        return route.fulfill({
          status: 403,
          json: {
            code: 'ACCESS_DENIED',
            detail: 'Не удалось подтвердить безопасность запроса.',
            requestId: 'test',
            fieldErrors: {},
          },
        });
      if (options.confirmationFailure === 'rate')
        return route.fulfill({
          status: 429,
          headers: { 'Retry-After': '30' },
          json: {
            code: 'RATE_LIMITED',
            detail: 'Слишком много попыток. Повторите позже.',
            requestId: 'test',
            fieldErrors: {},
          },
        });
      if (request.postDataJSON().password !== 'secret123')
        return route.fulfill({
          status: 401,
          json: {
            code: 'INVALID_CREDENTIALS',
            detail: 'Неверный логин или пароль.',
            requestId: 'test',
            fieldErrors: {},
          },
        });
      fresh = true;
      body = { fresh: true };
    } else if (path === '/auth/webauthn/credentials' && method === 'GET')
      body = options.emptyKeys
        ? []
        : [
            {
              id: 'key1',
              label: 'Телефон',
              createdAt: '2026-11-01T00:00:00Z',
              lastUsedAt: '2026-11-01T00:00:00Z',
            },
          ];
    else if (path === '/auth/webauthn/credentials/key1' && method === 'PATCH') {
      calls.push('rename');
      body = { message: 'Сохранено.' };
    } else if (path === '/admin/alfa-config' && method === 'GET')
      body = { enabled: false, configured: false, candidatePresent: true, updatedAt: null };
    else if (path === '/admin/alfa-config/candidate' && method === 'POST') {
      calls.push('candidate');
    } else if (path === '/admin/alfa-config/candidate/check' && method === 'POST') {
      calls.push('check');
      if (options.lostCommand) return route.abort('failed');
      if (options.staleCommand)
        return route.fulfill({
          status: 401,
          json: {
            code: 'REAUTH_REQUIRED',
            detail:
              'Подтверждение пароля истекло. Проверьте результат и при необходимости повторите действие.',
            requestId: 'test',
            fieldErrors: {},
          },
        });
    } else if (path === '/admin/users' && method === 'GET')
      body = { items: [], page: 0, size: 25, total: 0 };
    else if (path === '/admin/users' && method === 'POST') {
      calls.push('create');
    }
    await route.fulfill({ json: body });
  });
  return calls;
}

for (const width of [375, 1440]) {
  test(`ключи и подтверждение в контексте на ${width}px`, async ({ page }) => {
    const calls = await fixture(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('account/security');
    const keys = page.getByRole('region', { name: 'Ключи доступа' });
    await expect(keys.getByLabel('Название', { exact: true })).toHaveValue('Телефон');
    await expect(page.getByText('Войдите заново для подтверждения действия.')).toHaveCount(0);
    await keys.getByLabel('Название', { exact: true }).fill('Новый телефон');
    await keys.getByRole('button', { name: 'Сохранить название' }).click();
    const dialog = page.getByRole('dialog', { name: 'Подтвердите пароль' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('переименовать ключ доступа');
    await expect(dialog.getByLabel('Текущий пароль', { exact: true })).toBeFocused();
    expect(calls).not.toContain('rename');
    await dialog.getByLabel('Текущий пароль', { exact: true }).fill('wrong');
    await dialog.getByRole('button', { name: 'Подтвердить и продолжить' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Неверный пароль');
    await expect(keys.getByLabel('Название', { exact: true })).toHaveValue('Новый телефон');
    await dialog.getByLabel('Текущий пароль', { exact: true }).fill('secret123');
    await dialog.getByRole('button', { name: 'Подтвердить и продолжить' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => calls.filter((x) => x === 'rename').length).toBe(1);
    await keys.getByRole('button', { name: 'Сохранить название' }).click();
    await expect.poll(() => calls.filter((x) => x === 'rename').length).toBe(2);
    await expect(page.getByRole('dialog', { name: 'Подтвердите пароль' })).toHaveCount(0);
  });
}

test('отмена сохраняет банковскую форму и не отправляет команду', async ({ page }) => {
  const calls = await fixture(page);
  await page.goto('account/security');
  await page.getByLabel('Тестовый логин').fill('test-login');
  await page.getByLabel('Тестовый пароль').fill('test-password');
  await page.getByLabel('Это реквизиты тестовой среды').check();
  await page.getByRole('button', { name: 'Сохранить для проверки' }).click();
  const dialog = page.getByRole('dialog', { name: 'Подтвердите пароль' });
  await expect(dialog).toContainText('сохранить тестовые реквизиты банка');
  await dialog.getByLabel('Текущий пароль', { exact: true }).fill('secret123');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel('Тестовый логин')).toHaveValue('test-login');
  await expect(page.getByLabel('Тестовый пароль')).toHaveValue('test-password');
  expect(calls).not.toContain('candidate');
  await page.getByRole('button', { name: 'Сохранить для проверки' }).click();
  await expect(dialog.getByLabel('Текущий пароль', { exact: true })).toHaveValue('');
});

test('запрос создания пользователя подтверждается без повторного ввода логина', async ({
  page,
}) => {
  const calls = await fixture(page);
  await page.goto('admin/users');
  await page.getByRole('button', { name: 'Добавить пользователя' }).click();
  await page.getByLabel('Имя', { exact: true }).fill('Тест');
  await page.getByLabel('Логин', { exact: true }).fill('testuser');
  await page.getByLabel('Временный пароль', { exact: true }).fill('temporary123');
  await page.getByRole('button', { name: 'Создать администратора' }).click();
  const dialog = page.getByRole('dialog', { name: 'Подтвердите пароль' });
  await expect(dialog).toContainText('создать пользователя');
  await expect(dialog.getByLabel('Логин')).toHaveCount(0);
  await dialog.getByLabel('Текущий пароль', { exact: true }).fill('secret123');
  await dialog.getByRole('button', { name: 'Подтвердить и продолжить' }).click();
  await expect.poll(() => calls.filter((x) => x === 'create').length).toBe(1);
});

test('истечение после отправки не повторяет банковскую команду', async ({ page }) => {
  const calls = await fixture(page, { fresh: true, staleCommand: true });
  await page.goto('account/security');
  await page.getByRole('button', { name: 'Проверить реквизиты' }).click();
  await expect(
    page.getByText('Подтверждение пароля истекло.', { exact: false }).first(),
  ).toBeVisible();
  expect(calls.filter((x) => x === 'check')).toHaveLength(1);
  await expect(page.getByRole('dialog', { name: 'Подтвердите пароль' })).toHaveCount(0);
});

test('пустой список ключей не запрашивает пароль', async ({ page }) => {
  await fixture(page, { emptyKeys: true });
  await page.goto('account/security');
  await expect(page.getByText('Ключей доступа пока нет.')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Подтвердите пароль' })).toHaveCount(0);
});

test('старый сервер не позволяет выполнить действие без новой проверки', async ({ page }) => {
  const calls = await fixture(page, { oldBackend: true });
  await page.goto('account/security');
  const keys = page.getByRole('region', { name: 'Ключи доступа' });
  await keys.getByLabel('Название', { exact: true }).fill('Сохранить ввод');
  await keys.getByRole('button', { name: 'Сохранить название' }).click();
  await expect(
    keys.getByText('Не удалось проверить подтверждение пароля.', { exact: false }),
  ).toBeVisible();
  await expect(keys.getByLabel('Название', { exact: true })).toHaveValue('Сохранить ввод');
  expect(calls).not.toContain('rename');
});

test('смена сессии закрывает подтверждение без отправки команды', async ({ page }) => {
  const calls = await fixture(page);
  await page.goto('account/security');
  const keys = page.getByRole('region', { name: 'Ключи доступа' });
  await keys.getByRole('button', { name: 'Сохранить название' }).click();
  const dialog = page.getByRole('dialog', { name: 'Подтвердите пароль' });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const channel = new BroadcastChannel('lastochka-auth');
    channel.postMessage('changed');
    channel.close();
  });
  await expect(dialog).toHaveCount(0);
  expect(calls).not.toContain('rename');
});

for (const failure of ['rate', 'network', 'csrf'] as const) {
  test(`ошибка подтверждения ${failure} сохраняет действие и не отправляет команду`, async ({
    page,
  }) => {
    const calls = await fixture(page, { confirmationFailure: failure });
    await page.goto('account/security');
    const keys = page.getByRole('region', { name: 'Ключи доступа' });
    await keys.getByLabel('Название', { exact: true }).fill('Сохранить название');
    await keys.getByRole('button', { name: 'Сохранить название' }).click();
    const dialog = page.getByRole('dialog', { name: 'Подтвердите пароль' });
    await dialog.getByLabel('Текущий пароль', { exact: true }).fill('secret123');
    await dialog.getByRole('button', { name: 'Подтвердить и продолжить' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(keys.getByLabel('Название', { exact: true })).toHaveValue('Сохранить название');
    expect(calls).not.toContain('rename');
  });
}

test('двойная отправка и отмена во время проверки не запускают команду', async ({ page }) => {
  const calls = await fixture(page, { delayConfirm: true });
  await page.goto('account/security');
  const keys = page.getByRole('region', { name: 'Ключи доступа' });
  await keys.getByRole('button', { name: 'Сохранить название' }).click();
  const dialog = page.getByRole('dialog', { name: 'Подтвердите пароль' });
  await dialog.getByLabel('Текущий пароль', { exact: true }).fill('secret123');
  await dialog.locator('form').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
    (form as HTMLFormElement).requestSubmit();
  });
  await expect.poll(() => calls.filter((x) => x === 'confirm').length).toBe(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.waitForTimeout(700);
  expect(calls).not.toContain('rename');
});

test('потерянный ответ банка не вызывает повторной отправки', async ({ page }) => {
  const calls = await fixture(page, { fresh: true, lostCommand: true });
  await page.goto('account/security');
  await page.getByRole('button', { name: 'Проверить реквизиты' }).click();
  await expect(page.getByRole('alert').first()).toContainText('Результат действия неизвестен');
  expect(calls.filter((x) => x === 'check')).toHaveLength(1);
  await expect(page.getByRole('dialog', { name: 'Подтвердите пароль' })).toHaveCount(0);
});
