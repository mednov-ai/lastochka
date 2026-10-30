import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

test('старая вкладка и сессия переживают замену локального frontend', async ({ browser }) => {
  writeFileSync('/tmp/lastochka-entry-upstream', '18147');
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
  const context = await browser.newContext({
    viewport: { width: 375, height: 900 },
    hasTouch: true,
  });
  const csrf = await (
    await context.request.get('http://localhost:18142/lastochka/api/v1/auth/csrf')
  ).json();
  const login = await context.request.post(
    'http://localhost:18142/lastochka/api/v1/auth/password-stage',
    {
      headers: { [csrf.headerName]: csrf.token, Origin: 'http://localhost:18142' },
      data: { login: 'entry-fixture', password: 'Fixture-pass-123' },
    },
  );
  expect(login.ok()).toBeTruthy();
  const page = await context.newPage();
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto('http://localhost:18146/lastochka/');
  await expect(page.getByLabel('Кабинет администратора')).toBeVisible();
  writeFileSync('/tmp/lastochka-entry-upstream', '18145');
  await page.getByLabel('Кабинет администратора').tap();
  await expect(page).toHaveURL('http://localhost:18146/lastochka/admin/schedule');
  await expect(page.getByRole('heading', { name: 'Расписание', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('footer .admin-entry')).toHaveText('Кабинет администратора');
  await page.getByRole('button', { name: 'Выйти', exact: true }).focus();
  await expect(page.getByRole('button', { name: 'Выйти', exact: true })).toBeFocused();
  expect(failures).toEqual([]);
  await context.close();
});
