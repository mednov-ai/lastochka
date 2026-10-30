import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const base = 'http://localhost:18142/lastochka';
async function login(request: APIRequestContext) {
  const token = await (await request.get(`${base}/api/v1/auth/csrf`)).json();
  const result = await request.post(`${base}/api/v1/auth/password-stage`, {
    headers: { [token.headerName]: token.token, Origin: 'http://localhost:18142' },
    data: { login: 'entry-fixture', password: 'Fixture-pass-123' },
  });
  expect(result.ok()).toBeTruthy();
}
async function openCalendar(page: Page) {
  await page.goto(`${base}/admin/schedule`);
  await expect(page.getByRole('button', { name: 'Группы', exact: true })).toBeVisible();
  await expect(page.getByText('Загружаем группы и расписания…')).toHaveCount(0);
}
test.beforeEach(() => {
  execFileSync(
    'docker',
    [
      'exec',
      'lastochka-entry-apply-postgres',
      'psql',
      '-U',
      'lastochka',
      '-d',
      'lastochka_entry',
      '-c',
      'DELETE FROM auth_limits',
    ],
    { stdio: 'ignore' },
  );
});

test('гость открывает и закрывает окно входа с возвратом фокуса', async ({ page }) => {
  await page.goto(base + '/');
  const entry = page.getByRole('link', { name: 'Для администратора' });
  await entry.focus();
  await entry.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Вход администратора' })).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть окно входа' }).click();
  await expect(entry).toBeFocused();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy();
});

test('кабинет в подвале и выход из каждого раздела', async ({ page, context }) => {
  await login(context.request);
  await page.goto(base + '/');
  const entry = page.locator('footer .admin-entry').filter({ hasText: 'Кабинет администратора' });
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/admin\/schedule$/);
  await expect(page.getByRole('dialog', { name: 'Вход администратора' })).toHaveCount(0);
  for (const path of [
    '/admin/schedule',
    '/admin/requests',
    '/admin/payments',
    '/admin/users',
    '/account/security',
  ]) {
    await page.goto(base + path);
    await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toHaveCount(1);
  }
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
  ).toBeTruthy();
  await page.screenshot({
    path: `../artifacts/admin-entry/${test.info().project.name}-security.png`,
    fullPage: true,
  });
  await page.getByRole('link', { name: 'Подтвердить пароль заново' }).click();
  await expect(page.getByRole('dialog', { name: 'Вход администратора' })).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Вход администратора' });
  await dialog.getByLabel('Логин', { exact: true }).fill('entry-fixture');
  await dialog.getByLabel('Пароль', { exact: true }).fill('Fixture-pass-123');
  await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(base + '/account/security');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL(/\/lastochka\/$/);
  await expect(page.getByRole('link', { name: 'Для администратора' })).toBeVisible();
  const me = await (await context.request.get(`${base}/api/v1/auth/me`)).json();
  expect(me.state).toBe('ANONYMOUS');
  expect((await context.request.get(`${base}/api/v1/admin/users`)).status()).not.toBe(200);
});

test('без JavaScript действующая сессия и гость разделены', async ({ browser }) => {
  const admin = await browser.newContext({ javaScriptEnabled: false });
  const guest = await browser.newContext({ javaScriptEnabled: false });
  await login(admin.request);
  const adminPage = await admin.newPage();
  await adminPage.goto(base + '/');
  await adminPage.getByRole('link', { name: 'Для администратора' }).click();
  await expect(adminPage).toHaveURL(base + '/admin/schedule');
  await expect(adminPage.locator('main noscript')).toBeVisible();
  const guestPage = await guest.newPage();
  await guestPage.goto(base + '/');
  await guestPage.getByRole('link', { name: 'Для администратора' }).click();
  await expect(guestPage.getByRole('heading', { name: 'Вход администратора' })).toBeVisible();
  await guestPage.goto(base + '/enquiry');
  await guestPage.getByLabel('Имя родителя').fill('Проверка без сценариев');
  await guestPage.getByLabel('Телефон', { exact: true }).fill('89001234567');
  await guestPage.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(guestPage.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();
  const response = await guest.request.get(base + '/auth/login');
  expect(response.headers()['cache-control']).toContain('no-store');
  await admin.close();
  await guest.close();
});

test('ошибка проверки и выхода не выдают успех', async ({ page, context }) => {
  await login(context.request);
  await page.goto(base + '/');
  await expect(
    page.locator('footer .admin-entry').filter({ hasText: 'Кабинет администратора' }),
  ).toBeVisible();
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE' } }),
  );
  await page.locator('footer .admin-entry').filter({ hasText: 'Кабинет администратора' }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Не удалось проверить вход' }),
  ).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Вход администратора' })).toHaveCount(0);
  await page.unroute('**/api/v1/auth/me');
  await page.getByRole('link', { name: 'Повторить проверку входа' }).click();
  await expect(page).toHaveURL(/\/admin\/schedule$/);
  await page.route('**/api/v1/auth/logout', (route) =>
    route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE' } }),
  );
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'недоступен' }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/schedule$/);
  expect((await (await context.request.get(`${base}/api/v1/auth/me`)).json()).state).toBe('FULL');
});

test('другая вкладка узнаёт о выходе', async ({ page, context }) => {
  await login(context.request);
  await page.goto(base + '/');
  const second = await context.newPage();
  await second.goto(base + '/admin/schedule');
  await expect(
    page.locator('footer .admin-entry').filter({ hasText: 'Кабинет администратора' }),
  ).toBeVisible();
  await second.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Для администратора' })).toBeVisible();
});

test('запоздавший ответ и пропущенное уведомление не открывают неверное действие', async ({
  page,
  context,
}) => {
  await login(context.request);
  await page.goto(base + '/');
  await expect(page.locator('footer .admin-entry')).toHaveText('Кабинет администратора');
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held!: () => void;
  const started = new Promise<void>((resolve) => {
    held = resolve;
  });
  let calls = 0;
  await page.route('**/api/v1/auth/me', async (route) => {
    if (++calls === 1) {
      held();
      await delayed;
      await route.fulfill({ json: { state: 'ANONYMOUS', account: null } });
    } else await route.continue();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await started;
  const latest = page.waitForResponse(
    (response) => response.url().endsWith('/auth/me') && response.ok(),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await latest;
  release();
  await expect(page.locator('footer .admin-entry')).toHaveText('Кабинет администратора');
  await page.unroute('**/api/v1/auth/me');
  const token = await (await context.request.get(`${base}/api/v1/auth/csrf`)).json();
  await context.request.post(`${base}/api/v1/auth/logout`, {
    headers: { [token.headerName]: token.token, Origin: 'http://localhost:18142' },
  });
  await page.locator('footer .admin-entry').click();
  await expect(page.getByRole('dialog', { name: 'Вход администратора' })).toBeVisible();
});

test('редактор предупреждает до выхода и сохраняет ввод при отмене', async ({ page, context }) => {
  await login(context.request);
  await openCalendar(page);
  await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
  const title = page.getByLabel('Название', { exact: true });
  await title.click();
  await title.pressSequentially('Не сохранено');
  await expect(title).toHaveValue('Не сохранено');
  // Modal editor prevents pointer access to the navigation; dispatch the same user action
  // to exercise the shared guard while the editor is open.
  await page.getByRole('button', { name: 'Выйти', exact: true }).dispatchEvent('click');
  const confirm = page.getByRole('dialog', { name: 'Выйти без сохранения?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Остаться' }).click();
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Не сохранено');
  expect((await (await context.request.get(`${base}/api/v1/auth/me`)).json()).state).toBe('FULL');
  await page.route('**/api/v1/auth/logout', (route) =>
    route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE' } }),
  );
  await page.getByRole('button', { name: 'Выйти', exact: true }).dispatchEvent('click');
  await confirm.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.locator('.workspace-panel').getByRole('alert')).toContainText('недоступен');
  await expect(page.getByLabel('Название', { exact: true })).toHaveValue('Не сохранено');
  expect((await (await context.request.get(`${base}/api/v1/auth/me`)).json()).state).toBe('FULL');
  await page.unroute('**/api/v1/auth/logout');
  await page.getByRole('button', { name: 'Выйти', exact: true }).dispatchEvent('click');
  await confirm.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page).toHaveURL(/\/lastochka\/$/);
  expect((await (await context.request.get(`${base}/api/v1/auth/me`)).json()).state).toBe(
    'ANONYMOUS',
  );
});

test('поздний ответ команды не открывает редактор после выхода', async ({ page, context }) => {
  await login(context.request);
  await openCalendar(page);
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let submitted!: () => void;
  const started = new Promise<void>((resolve) => {
    submitted = resolve;
  });
  await page.route('**/api/v1/admin/sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    const result = await route.fetch();
    submitted();
    await delayed;
    await route.fulfill({ response: result });
  });
  await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
  await expect(page.locator('.calendar-dialog')).toBeVisible();
  await page.waitForTimeout(300);
  await page.getByLabel('Название', { exact: true }).fill('Задержанная проверка');
  await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await started;
  await page.getByRole('button', { name: 'Выйти', exact: true }).dispatchEvent('click');
  const confirm = page.getByRole('dialog', { name: 'Закрыть окно?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Закрыть окно' }).click();
  await expect(page).toHaveURL(/\/lastochka\/$/);
  release();
  await page.waitForTimeout(300);
  await expect(page.locator('.workspace-panel')).toHaveCount(0);
  expect((await (await context.request.get(`${base}/api/v1/auth/me`)).json()).state).toBe(
    'ANONYMOUS',
  );
});

test('ограниченная сессия ведёт к смене пароля и позволяет выйти', async ({
  browser,
  context,
  page,
}) => {
  await login(context.request);
  const loginName = 'entry-' + randomUUID().slice(0, 8);
  const token = await (await context.request.get(`${base}/api/v1/auth/csrf`)).json();
  const created = await context.request.post(`${base}/api/v1/admin/users`, {
    headers: { [token.headerName]: token.token, Origin: 'http://localhost:18142' },
    data: {
      login: loginName,
      name: 'Проверка',
      role: 'ADMIN',
      temporaryPassword: 'Fixture-temporary-123',
    },
  });
  expect(created.status()).toBe(201);
  const user = await created.json();
  const limited = await browser.newContext();
  const csrf = await (await limited.request.get(`${base}/api/v1/auth/csrf`)).json();
  const response = await limited.request.post(`${base}/api/v1/auth/password-stage`, {
    headers: { [csrf.headerName]: csrf.token, Origin: 'http://localhost:18142' },
    data: { login: loginName, password: 'Fixture-temporary-123' },
  });
  expect((await response.json()).state).toBe('PASSWORD_CHANGE_REQUIRED');
  const noScript = await browser.newContext({
    javaScriptEnabled: false,
    storageState: await limited.storageState(),
  });
  const noScriptPage = await noScript.newPage();
  await noScriptPage.goto(base + '/auth/login');
  await expect(noScriptPage).toHaveURL(base + '/account/change-password');
  await expect(noScriptPage.locator('main noscript')).toBeVisible();
  await noScript.close();
  const target = await limited.newPage();
  await target.goto(base + '/');
  await target.locator('footer .admin-entry').filter({ hasText: 'Сменить пароль' }).click();
  await expect(target).toHaveURL(/\/account\/change-password$/);
  await target.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(target).toHaveURL(/\/lastochka\/$/);
  expect((await (await limited.request.get(`${base}/api/v1/auth/me`)).json()).state).toBe(
    'ANONYMOUS',
  );
  const csrfAgain = await (await limited.request.get(`${base}/api/v1/auth/csrf`)).json();
  await limited.request.post(`${base}/api/v1/auth/password-stage`, {
    headers: { [csrfAgain.headerName]: csrfAgain.token, Origin: 'http://localhost:18142' },
    data: { login: loginName, password: 'Fixture-temporary-123' },
  });
  await target.goto(base + '/');
  await expect(target.locator('footer .admin-entry')).toHaveText('Сменить пароль');
  const reset = await context.request.post(
    `${base}/api/v1/admin/users/${user.id}/temporary-password`,
    {
      headers: { [token.headerName]: token.token, Origin: 'http://localhost:18142' },
      data: { revision: user.revision, temporaryPassword: 'Fixture-new-temporary-123' },
    },
  );
  expect(reset.ok()).toBeTruthy();
  await target.locator('footer .admin-entry').click();
  await expect(target.getByRole('dialog', { name: 'Вход администратора' })).toBeVisible();
  await limited.close();
});
