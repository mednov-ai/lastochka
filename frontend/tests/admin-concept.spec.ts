import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
function sql(query: string) {
  if (process.env.TEST_DATABASE_CONTAINER !== 'lastochka-concept-postgres')
    throw new Error('An isolated concept database is required');
  const r = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      'lastochka-concept-postgres',
      'psql',
      '-U',
      'lastochka',
      '-d',
      'lastochka_concept',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: query, encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(r.stderr);
}
const base = (process.env.TEST_APP_URL ?? 'http://localhost:5179/lastochka').replace(/\/$/, '');
test.beforeEach(async ({}, info) => {
  const login = 'browser-' + info.project.name.toLowerCase();
  sql(
    `DELETE FROM auth_limits; INSERT INTO accounts(id,email,name,password_hash,role,verified_at,login,admin_enabled) SELECT gen_random_uuid(),'${login}','Администратор проверки',password_hash,'ADMIN',now(),'${login}',true FROM accounts WHERE login='fixture-admin' ON CONFLICT(email) DO NOTHING;`,
  );
});
test('guest form accepts without an account, gives Russian field errors, and closes legacy paths', async ({
  page,
}, info) => {
  await page.goto(base + '/');
  await page
    .locator('.landing-formats')
    .getByRole('link', { name: 'Выбрать занятие' })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Заявка на занятие' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Электронная почта' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.locator('.field-error').filter({ hasText: 'Заполните' }).first()).toBeVisible();
  await page.getByLabel('Ваше имя').fill('Родитель ' + info.project.name);
  await page.getByLabel('Имя ребёнка').fill('Ребёнок');
  await page.getByLabel('Возраст ребёнка').fill('7');
  await page.getByLabel('Телефон', { exact: true }).fill('неверный телефон');
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByLabel('Телефон', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(
    page.getByRole('status').filter({ hasText: 'Лишние цифры и буквы недопустимы' }),
  ).toBeVisible();
  await page.getByLabel('Телефон', { exact: true }).fill('+7 900 123-45-67');
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();
  await expect(
    page.getByText('Это ещё не подтверждённая запись, место не забронировано.'),
  ).toBeVisible();
  await page.goto(base + '/auth/register');
  await expect(
    page.getByRole('heading', { name: 'Теперь можно оставить заявку без аккаунта' }),
  ).toBeVisible();
  await expect(page.locator('input')).toHaveCount(0);
  await page.goto(base + '/account/bookings');
  await expect(
    page.getByRole('heading', { name: 'Теперь можно оставить заявку без аккаунта' }),
  ).toBeVisible();
  expect((await page.request.get(base + '/mail_hog_test/')).status()).toBe(404);
  expect((await page.request.get(base + '/api/v1/bookings')).status()).toBe(410);
});
test('administrator manages schedule, sees enquiries and prepares an honest payment draft', async ({
  page,
}, info) => {
  await page.goto(base + '/auth/login');
  await page
    .getByLabel('Логин', { exact: true })
    .fill('browser-' + info.project.name.toLowerCase());
  await page.getByLabel('Пароль', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('alert').first()).toContainText('логин');
  await page.getByLabel('Пароль', { exact: true }).fill('Fixture-pass-123');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Расписание', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Мои дети' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  await panel.getByLabel('Формат').selectOption('INDIVIDUAL');
  await panel.getByLabel('Название', { exact: true }).fill('Черновик ' + info.project.name);
  const date = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
  await panel.getByLabel('Дата занятия · МСК').fill(date);
  await panel.getByLabel('Начало · МСК').fill('10:00');
  await panel.getByLabel('Длительность, минут').fill('60');
  await panel.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('Черновик сохранён');
  await panel.getByRole('button', { name: 'Проверить изменения', exact: true }).click();
  await expect(
    panel.getByRole('button', { name: 'Подтвердить публикацию', exact: true }),
  ).toBeEnabled();
  await panel.getByRole('button', { name: 'Закрыть панель', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole('link', { name: 'Заявки', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть заявку' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Ожидает настройки бота');
  await page.getByRole('button', { name: 'Подготовить оплату' }).click();
  await expect(page.getByLabel('Имя получателя')).not.toHaveValue('');
  await page.getByLabel('Сумма в рублях').fill('123.45');
  await page.getByLabel('Назначение', { exact: true }).fill('Занятие ' + info.project.name);
  await expect(page.getByRole('button', { name: 'Создать платёжную ссылку' })).toBeDisabled();
  await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Оплата', exact: true }).click();
  await expect(
    page.getByText('Занятие ' + info.project.name, { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText('123,45', { exact: false }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  mkdirSync('../artifacts/admin-concept/screenshots', { recursive: true });
  for (const button of await page
    .getByRole('button', { name: 'Закрыть уведомление', exact: true })
    .all())
    await button.click();
  await page.screenshot({
    path: '../artifacts/admin-concept/screenshots/' + info.project.name + '.png',
    fullPage: true,
  });
});
test('guest form works without JavaScript and private data stays unavailable', async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: info.project.use.viewport?.width ?? 375, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(base + '/enquiry');
  await page.getByLabel('Ваше имя').fill('Без сценариев');
  await page.getByLabel('Имя ребёнка').fill('Ребёнок');
  await page.getByLabel('Возраст ребёнка').fill('7');
  await page.getByLabel('Телефон', { exact: true }).fill('89001234567');
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();
  expect((await page.request.get(base + '/api/v1/admin/enquiries')).status()).not.toBe(200);
  await context.close();
});

test('administrator may bind and verify a voluntary key and still use a password', async ({
  page,
  browserName,
  context,
}, info) => {
  test.skip(browserName !== 'chromium', 'Virtual WebAuthn uses Chromium CDP');
  const cdp = await context.newCDPSession(page);
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
  await page.goto(base + '/auth/login');
  await page
    .getByLabel('Логин', { exact: true })
    .fill('browser-' + info.project.name.toLowerCase());
  await page.getByLabel('Пароль', { exact: true }).fill('Fixture-pass-123');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Расписание', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Безопасность', exact: true }).click();
  await page.getByLabel('Название ключа', { exact: true }).fill('Ключ проверки ' + Date.now());
  await page.getByRole('button', { name: 'Добавить ключ доступа ↗', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Проверить ключ доступа', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Проверить ключ доступа', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Ключ доступа подтверждён.');
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Гимнастика для детей и взрослых' })).toBeVisible();
  await page.goto(base + '/auth/login');
  await page
    .getByLabel('Логин', { exact: true })
    .fill('browser-' + info.project.name.toLowerCase());
  await page.getByLabel('Пароль', { exact: true }).fill('Fixture-pass-123');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Расписание', exact: true })).toBeVisible();
});
