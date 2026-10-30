import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const out = new URL('../../artifacts/password-lifecycle-baseline/', import.meta.url).pathname;
const base = (process.env.TEST_APP_URL ?? 'http://localhost:5181/lastochka').replace(/\/$/, '');
if (base !== 'http://localhost:5181/lastochka')
  throw new Error('Dedicated password preview required');
const operator = 'Local-operator-2026',
  temporary = 'Temporary-browser-2026',
  permanent = 'Permanent-browser-2026',
  second = 'Second-browser-2026';
async function login(page: Page, login: string, password: string, next = '/admin/users') {
  await page.goto(base + '/auth/login?next=' + encodeURIComponent(next));
  await page.getByLabel('Логин', { exact: true }).fill(login);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
}
async function command(page: Page, path: string, body: unknown) {
  const token = await (await page.request.get(base + '/api/v1/auth/csrf')).json();
  return page.request.post(base + path, {
    data: body,
    headers: { [token.headerName]: token.token },
  });
}
test.beforeEach(() => {
  execFileSync(
    'docker',
    [
      'exec',
      'lastochka-password-lifecycle-postgres',
      'psql',
      '-U',
      'lastochka',
      '-d',
      'password_lifecycle',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'DELETE FROM auth_limits;',
    ],
    { stdio: 'pipe' },
  );
});
test.afterEach(() => {
  // Dedicated disposable database only; no operator or unrelated account is touched.
  execFileSync(
    'docker',
    [
      'exec',
      'lastochka-password-lifecycle-postgres',
      'psql',
      '-U',
      'lastochka',
      '-d',
      'password_lifecycle',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      "BEGIN; DELETE FROM spring_session WHERE principal_name IN(SELECT email FROM accounts WHERE login LIKE 'browser-%'); DELETE FROM webauthn_challenges WHERE account_id IN(SELECT id FROM accounts WHERE login LIKE 'browser-%'); DELETE FROM audit_events WHERE actor_id IN(SELECT id FROM accounts WHERE login LIKE 'browser-%') OR aggregate_id IN(SELECT id FROM accounts WHERE login LIKE 'browser-%'); DELETE FROM user_credentials WHERE user_entity_user_id IN(SELECT id FROM user_entities WHERE name IN(SELECT email FROM accounts WHERE login LIKE 'browser-%')); DELETE FROM user_entities WHERE name IN(SELECT email FROM accounts WHERE login LIKE 'browser-%'); DELETE FROM accounts WHERE login LIKE 'browser-%'; COMMIT;",
    ],
    { stdio: 'pipe' },
  );
});

test('create, mandatory change, own change, reset and preserved key', async ({
  page,
  browser,
  browserName,
}, info) => {
  const loginName = 'browser-' + randomUUID().slice(0, 8),
    name = 'Проверка ' + loginName;
  await login(page, 'password-operator', operator);
  await expect(page.getByRole('heading', { name: 'Пользователи', exact: true })).toBeVisible();
  const response = await page.request.get(base + '/admin/users');
  expect(response.headers()['cache-control']).toContain('no-store');
  await page.getByRole('button', { name: 'Добавить пользователя', exact: true }).click();
  await page.getByLabel('Имя', { exact: true }).fill(name);
  await page.getByLabel('Логин', { exact: true }).fill(loginName);
  await page.getByLabel('Временный пароль', { exact: true }).fill(temporary);
  await page
    .getByRole('button', { name: 'Показать пароль: Временный пароль', exact: true })
    .click();
  await expect(page.getByLabel('Временный пароль', { exact: true })).toHaveAttribute(
    'type',
    'text',
  );
  await page.getByRole('button', { name: 'Скрыть пароль: Временный пароль', exact: true }).click();
  await page.getByRole('button', { name: 'Создать администратора', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Временный пароль назначен');
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  const owner = await browser.newContext({
    locale: info.project.use.locale,
    viewport: info.project.use.viewport,
  });
  const target = await owner.newPage();
  try {
    await login(target, loginName, temporary);
    await expect(target).toHaveURL(/account\/change-password$/);
    await expect(target.getByRole('heading', { name: 'Задайте постоянный пароль' })).toBeVisible();
    expect((await target.request.get(base + '/api/v1/admin/users')).status()).toBe(403);
    await target.goto(base + '/admin/payments');
    await expect(target).toHaveURL(/account\/change-password$/);
    await target.getByLabel('Временный пароль', { exact: true }).fill(temporary);
    await target.getByLabel('Новый пароль', { exact: true }).fill(permanent);
    await target.getByLabel('Повторите новый пароль', { exact: true }).fill('Mismatch-2026');
    await target.getByRole('button', { name: 'Сохранить пароль', exact: true }).click();
    await expect(target.locator('main').getByRole('alert')).toContainText('Подтверждение');
    await target.getByLabel('Повторите новый пароль', { exact: true }).fill(permanent);
    await target.screenshot({ path: `${out}${info.project.name}-mandatory.png`, fullPage: true });
    await target.getByRole('button', { name: 'Сохранить пароль', exact: true }).click();
    await expect(target).toHaveURL(/admin\/schedule$/);
    await target.goto(base + '/account/security');
    let cdp;
    if (browserName === 'chromium') {
      cdp = await owner.newCDPSession(target);
      await cdp.send('WebAuthn.enable');
      await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
          protocol: 'ctap2',
          transport: 'internal',
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      });
      await target.getByLabel('Название ключа', { exact: true }).fill('Проверочный ключ');
      await target.getByRole('button', { name: 'Добавить ключ доступа ↗', exact: true }).click();
      await expect(
        target.getByRole('button', { name: 'Проверить ключ доступа', exact: true }),
      ).toBeVisible();
    }
    await target.getByLabel('Текущий пароль', { exact: true }).fill(permanent);
    await target.getByLabel('Новый пароль', { exact: true }).fill(second);
    await target.getByLabel('Повторите новый пароль', { exact: true }).fill(second);
    await target.getByRole('button', { name: 'Сохранить пароль', exact: true }).click();
    await expect(target.getByRole('status')).toContainText('Пароль изменён');
    await target.reload();
    await expect(target.getByRole('heading', { name: 'Безопасность аккаунта' })).toBeVisible();
    await page.reload();
    const card = page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { name, exact: true }) });
    await card.getByRole('button', { name: 'Назначить временный пароль', exact: true }).click();
    await page.getByRole('checkbox').check();
    await page.getByLabel('Временный пароль', { exact: true }).fill(temporary);
    await page
      .locator('form')
      .getByRole('button', { name: 'Назначить временный пароль', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText('Временный пароль назначен');
    expect((await target.request.get(base + '/api/v1/admin/users')).status()).toBe(401);
    await login(target, loginName, temporary);
    await expect(target).toHaveURL(/account\/change-password$/);
    expect((await target.request.get(base + '/api/v1/auth/webauthn/credentials')).status()).toBe(
      403,
    );
    await target.getByLabel('Временный пароль', { exact: true }).fill(temporary);
    await target.getByLabel('Новый пароль', { exact: true }).fill(second);
    await target.getByLabel('Повторите новый пароль', { exact: true }).fill(second);
    await target.getByRole('button', { name: 'Сохранить пароль', exact: true }).click();
    await expect(target).toHaveURL(/admin\/schedule$/);
    await target.goto(base + '/account/security');
    if (cdp) {
      await target.getByRole('button', { name: 'Проверить ключ доступа', exact: true }).click();
      await expect(target.getByRole('status')).toContainText('Ключ доступа подтверждён');
    }
    await target.locator('html').evaluate((el) => (el.style.fontSize = '200%'));
    expect(
      await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    ).toBe(true);
    await target.screenshot({ path: `${out}${info.project.name}-security.png`, fullPage: true });
    const storage = await target.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
    expect(storage).not.toContain(temporary);
    expect(storage).not.toContain(second);
  } finally {
    await owner.close();
  }
});

test('cancel clears secret and no-JS access stays closed', async ({ page, browser }) => {
  await login(page, 'password-operator', operator);
  await expect(page.getByRole('heading', { name: 'Пользователи', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Добавить пользователя', exact: true }).click();
  await page.getByLabel('Временный пароль', { exact: true }).fill(temporary);
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить пользователя', exact: true }).click();
  await expect(page.getByLabel('Временный пароль', { exact: true })).toHaveValue('');
  const owner = await browser.newContext({ javaScriptEnabled: false });
  const target = await owner.newPage();
  try {
    await target.goto(base + '/admin/users');
    await expect(target.locator('main noscript')).toBeVisible();
    expect((await target.request.get(base + '/api/v1/admin/users')).status()).toBe(401);
  } finally {
    await owner.close();
  }
});
