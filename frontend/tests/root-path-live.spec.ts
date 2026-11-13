import { test, expect } from '@playwright/test';

// Only the disposable database and containers launched by test-root-stack.py are allowed.
const base = process.env.ROOT_FIXTURE_URL;
test.skip(
  !base || !/^http:\/\/localhost:\d+$/.test(base),
  'Requires the isolated root-path fixture',
);

test('корневой сайт и прежние адреса доступны гостю', async ({ page }) => {
  await page.goto(`${base}/`);
  await expect(page).toHaveURL(`${base}/`);
  await expect(page.locator('#schedule')).toHaveCount(1);
  await page.goto(`${base}/enquiry`);
  await expect(page.getByRole('heading', { name: 'Заявка на занятие' })).toBeVisible();
  const old = await page.request.get(`${base}/lastochka/enquiry?fixture=1`, { maxRedirects: 0 });
  expect(old.status()).toBe(308);
  expect(old.headers().location).toBe('/enquiry?fixture=1');
  const oldAsset = process.env.ROOT_FIXTURE_OLD_ASSET;
  expect(oldAsset).toBeTruthy();
  const redirectedAsset = await page.request.get(`${base}/lastochka/assets/${oldAsset}`, {
    maxRedirects: 0,
  });
  expect(redirectedAsset.status()).toBe(308);
  const asset = await page.request.get(`${base}${redirectedAsset.headers().location}`);
  expect(asset.status()).toBe(200);
  const privateApi = await page.request.get(`${base}/api/v1/admin/users`);
  expect(privateApi.status()).toBe(401);
});

test('администратор входит в корне и получает параметры ключа', async ({ page, context }) => {
  const csrf = await (await page.request.get(`${base}/api/v1/auth/csrf`)).json();
  const login = await page.request.post(`${base}/api/v1/auth/password-stage`, {
    headers: { [csrf.headerName]: csrf.token },
    data: { login: 'rootfixture', password: 'Fixture-root-password-2026' },
  });
  expect(login.status()).toBe(200);
  const identity = await login.json();
  expect(identity.state).toBe('FULL');
  const session = (await context.cookies()).find((cookie) => cookie.name === 'LASTOCHKA_SESSION');
  expect(session?.path).toBe('/');
  await page.goto(`${base}/`);
  await page.evaluate((actor) => {
    sessionStorage.setItem(
      'lastochka-calendar-commands-v1',
      JSON.stringify([
        {
          key: 'fixture-pending-command',
          actor,
          url: '/lastochka/api/v1/admin/sessions',
          resource: '/lastochka/api/v1/admin/sessions',
          method: 'POST',
          body: '{}',
          started: Date.now(),
          status: 'unknown',
        },
      ]),
    );
  }, identity.account.id);
  await page.goto(`${base}/admin/schedule`);
  await expect(page.getByLabel('Состояние сохранения')).toContainText('Результат пока неизвестен');
  const pending = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('lastochka-calendar-commands-v1') ?? '[]'),
  );
  expect(pending[0].url).toBe('/api/v1/admin/sessions');
  expect(pending[0].key).toBe('fixture-pending-command');
  await page.evaluate(() => sessionStorage.removeItem('lastochka-calendar-commands-v1'));
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await page.goto(`${base}/admin/users`);
  await expect(page.getByRole('heading', { name: /Пользователи/ })).toBeVisible();
  const currentCsrf = await (await page.request.get(`${base}/api/v1/auth/csrf`)).json();
  const options = await page.request.post(`${base}/api/v1/auth/webauthn/registration/options`, {
    headers: { [currentCsrf.headerName]: currentCsrf.token },
  });
  expect(options.status()).toBe(200);
  const body = await options.json();
  expect(JSON.stringify(body)).toContain('localhost');
});

test('серверная форма заявки доступна без JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto(`${base}/enquiry`);
    await expect(page.getByRole('heading', { name: 'Заявка на занятие' })).toBeVisible();
    await expect(page.locator('form')).toHaveCount(1);
    await page.getByRole('button', { name: 'Выбрать занятие', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Помогите подобрать время' })).toBeVisible();
  } finally {
    await context.close();
  }
});
