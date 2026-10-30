import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
test.beforeEach(() => {
  execFileSync('docker', [
    'exec',
    'lastochka-concept-smoke-postgres-1',
    'psql',
    '-U',
    'lastochka',
    '-d',
    'lastochka',
    '-c',
    'DELETE FROM auth_limits',
  ]);
});
const base = 'https://localhost:18489/lastochka';
test('Linux images accept a guest form and an administrator prepares a draft over HTTPS', async ({
  page,
  context,
}, info) => {
  await page.goto(base + '/enquiry');
  await page.getByLabel('Имя родителя').fill('Проверка HTTPS ' + info.project.name);
  await page.getByLabel('Телефон', { exact: true }).fill('89001234567');
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === 'LASTOCHKA_SESSION')?.secure).toBe(true);
  expect(cookies.find((c) => c.name === 'LASTOCHKA_SESSION')?.httpOnly).toBe(true);
  expect(cookies.find((c) => c.name === 'LASTOCHKA_SESSION')?.path).toBe('/lastochka');
  await page.goto(base + '/auth/login');
  await page.getByLabel('Логин', { exact: true }).fill('smoke-admin');
  await page.getByLabel('Пароль', { exact: true }).fill('Fixture-pass-123');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Расписание', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Заявки', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть заявку' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Ожидает настройки бота');
  await page.getByRole('button', { name: 'Подготовить оплату', exact: true }).click();
  await page.getByLabel('Сумма в рублях').fill('321.45');
  await page.getByLabel('Назначение', { exact: true }).fill('HTTPS ' + info.project.name);
  await expect(
    page.getByRole('button', { name: 'Создать платёжную ссылку', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('link', { name: 'Оплата', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'HTTPS ' + info.project.name, exact: true }).first(),
  ).toBeVisible();
  for (const path of ['/mail_hog_test', '/mail_hog_test/', '/mail_hog_test/api/v2/messages'])
    expect((await page.request.get(base + path)).status()).toBe(404);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
  await page.screenshot({
    path: resolve(
      import.meta.dirname,
      '../../artifacts/admin-concept/screenshots/linux-https-' + info.project.name + '.png',
    ),
    fullPage: true,
  });
});
test('HTTPS form submits without JavaScript', async ({ browser }, info) => {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    javaScriptEnabled: false,
    viewport: { width: info.project.use.viewport?.width ?? 375, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(base + '/enquiry');
  await page.getByLabel('Имя родителя').fill('Без сценариев HTTPS');
  await page.getByLabel('Телефон', { exact: true }).fill('+79001234567');
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();
  await context.close();
});
