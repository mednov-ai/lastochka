import { test, expect, type Page, type Locator } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const base = (process.env.TEST_APP_URL ?? 'http://localhost:5181/lastochka').replace(/\/$/, '');
const local = base === 'http://localhost:5181/lastochka';
const fixture = process.env.TEST_ADMIN_FILE
  ? (JSON.parse(readFileSync(process.env.TEST_ADMIN_FILE, 'utf8')) as {
      login: string;
      password: string;
    })
  : null;
const output = resolve(
  process.env.PASSWORD_OUTPUT ??
    new URL('../../artifacts/password-visibility/', import.meta.url).pathname,
);
mkdirSync(output, { recursive: true });
const sample = '  Preview-Only-2026  ';
const eye = (field: Locator) => field.locator('..').getByRole('button');

async function login(page: Page, next: string) {
  if (!local && !fixture)
    throw new Error('Dedicated local preview or explicit disposable account required');
  await page.goto(base + '/auth/login?next=' + encodeURIComponent(next));
  await page.getByLabel('Логин', { exact: true }).fill(fixture?.login ?? 'password-operator');
  await page.getByLabel('Пароль', { exact: true }).fill(fixture?.password ?? 'Local-operator-2026');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(base + next);
}

test('direct and modal login preserve editing, errors and keyboard behavior', async ({
  page,
  browserName,
}) => {
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') requests.push(r.url());
  });
  await page.goto(base + '/auth/login');
  const field = page.getByLabel('Пароль', { exact: true });
  const button = eye(field);
  await expect(button).toBeEnabled();
  await expect(field).toHaveAttribute('type', 'password');
  await button.click();
  await expect(field).toHaveAttribute('type', 'text');
  await expect(page.locator('.form-validation')).toHaveCount(0);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  const errorId = await field.getAttribute('aria-describedby');
  await button.click();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(await field.getAttribute('aria-describedby')).toBe(errorId);
  await field.fill(sample);
  await field.evaluate((el: HTMLInputElement) => el.setSelectionRange(2, 9, 'backward'));
  await button.click();
  await expect(field).toBeFocused();
  await expect(field).toHaveValue(sample);
  expect(
    await field.evaluate((el: HTMLInputElement) => [
      el.selectionStart,
      el.selectionEnd,
      el.selectionDirection,
    ]),
  ).toEqual([2, 9, 'backward']);
  await page.keyboard.type('EDIT');
  await expect(field).toHaveValue(sample.slice(0, 2) + 'EDIT' + sample.slice(9));
  await field.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(button).toBeFocused();
  await button.press('Enter');
  await expect(button).toBeFocused();
  await expect(field).toHaveAttribute('type', 'password');
  await button.press('Space');
  await expect(field).toHaveAttribute('type', 'text');
  expect(await button.getAttribute('aria-label')).toBe('Скрыть пароль: Пароль');
  await expect(field).toHaveAttribute('autocomplete', 'current-password');
  expect(requests).toEqual([]);

  let submitted: unknown;
  await page.route('**/api/v1/auth/password-stage', async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      status: 401,
      json: { code: 'INVALID_CREDENTIALS', detail: 'Неверный логин или пароль.' },
    });
  });
  await page.getByLabel('Логин', { exact: true }).fill('preview-only');
  // Paste/autofill-like input in the same DOM field, without changing its semantics.
  await field.fill(sample);
  await field.press('Enter');
  await expect(page.getByRole('alert').first()).toContainText('Неверный логин');
  expect(submitted).toEqual({ login: 'preview-only', password: sample });
  expect(requests).toHaveLength(1);
  await expect(field).toHaveValue(sample);
  await expect(field).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(submitted).toEqual({ login: 'preview-only', password: sample });

  await page.goto(base + '/');
  const entry = page.locator('footer .admin-entry');
  await entry.click();
  const dialog = page.getByRole('dialog');
  const modal = dialog.getByLabel('Пароль', { exact: true });
  await modal.fill(sample);
  await eye(modal).click();
  await expect(modal).toHaveAttribute('type', 'text');
  const first = dialog.getByRole('button', { name: 'Закрыть окно входа' });
  await first.focus();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Войти', exact: true })).toBeFocused();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(entry).toBeFocused();
  await entry.click();
  await expect(dialog.getByLabel('Пароль', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Пароль', { exact: true })).toHaveAttribute('type', 'password');
});

test('own change and user forms keep independent visibility and reset it', async ({ page }) => {
  test.skip(!local && !fixture, 'An isolated preview or explicit disposable account is required');
  await login(page, '/account/security');
  const current = page.getByLabel('Текущий пароль', { exact: true });
  const next = page.getByLabel('Новый пароль', { exact: true });
  const confirm = page.getByLabel('Повторите новый пароль', { exact: true });
  await current.fill('Wrong-current-2026');
  await next.fill(sample);
  await confirm.fill(sample);
  await eye(next).click();
  await expect(next).toHaveAttribute('type', 'text');
  await expect(current).toHaveAttribute('type', 'password');
  await expect(confirm).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Сохранить пароль', exact: true }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('Текущий пароль');
  await expect(next).toHaveValue(sample);
  await expect(next).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Очистить поля', exact: true }).click();
  for (const field of [current, next, confirm]) {
    await expect(field).toHaveValue('');
    await expect(field).toHaveAttribute('type', 'password');
  }
  await page.goto(base + '/admin/users');
  await page.getByRole('button', { name: 'Добавить пользователя', exact: true }).click();
  const temporary = page.getByLabel('Временный пароль', { exact: true });
  await temporary.fill(sample);
  await eye(temporary).click();
  await expect(temporary).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить пользователя', exact: true }).click();
  await expect(temporary).toHaveValue('');
  await expect(temporary).toHaveAttribute('type', 'password');
  await expect(temporary).toHaveAttribute('autocomplete', 'new-password');
});

async function geometry(page: Page) {
  for (const field of await page.locator('.password-field input').all()) {
    await field.fill(sample.repeat(5));
    const button = eye(field);
    await page.keyboard.press('Tab');
    await button.focus();
    const measurements = await field.evaluate((node: HTMLInputElement) => {
      const control = node.parentElement!;
      const toggle = control.querySelector('button')!;
      const label = node.labels![0].getBoundingClientRect();
      const a = node.getBoundingClientRect(),
        b = toggle.getBoundingClientRect();
      const s = getComputedStyle(node),
        t = getComputedStyle(toggle);
      const lum = (color: string) =>
        (color.match(/[\d.]+/g) ?? [])
          .slice(0, 3)
          .map(Number)
          .reduce(
            (sum, v, i) =>
              sum +
              [0.2126, 0.7152, 0.0722][i] *
                (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4),
            0,
          );
      const l1 = lum(t.outlineColor),
        l2 = lum(s.backgroundColor);
      return {
        width: b.width,
        height: b.height,
        reserved: a.right - parseFloat(s.paddingRight) <= b.left,
        contained: b.left >= a.left && b.right <= a.right && b.top >= a.top && b.bottom <= a.bottom,
        gap: a.top - parseFloat(s.outlineOffset) - parseFloat(s.outlineWidth) - label.bottom,
        outline: t.outlineStyle,
        contrast: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05),
      };
    });
    expect(measurements.width).toBeGreaterThanOrEqual(44);
    expect(measurements.height).toBeGreaterThanOrEqual(44);
    expect(measurements.reserved).toBe(true);
    expect(measurements.contained).toBe(true);
    expect(measurements.gap).toBeGreaterThanOrEqual(2);
    expect(measurements.outline).toBe('solid');
    expect(measurements.contrast).toBeGreaterThanOrEqual(3);
    const previousType = await field.getAttribute('type');
    await button.click();
    await expect(field).toHaveAttribute('type', previousType === 'password' ? 'text' : 'password');
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}

test('eye remains visible and usable at 320px and 200 percent text', async ({ page }, info) => {
  await page.goto(base + '/auth/login');
  await expect(page.locator('.password-toggle')).toBeEnabled();
  await geometry(page);
  await page.screenshot({
    path: `${output}/${info.project.name}-direct-visible.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await geometry(page);
  await page.screenshot({
    path: `${output}/${info.project.name}-320-large-hidden.png`,
    fullPage: true,
  });
  if (local || fixture) {
    await login(page, '/account/security');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await geometry(page);
    await page.screenshot({
      path: `${output}/${info.project.name}-change-large.png`,
      fullPage: true,
    });
    await page.goto(base + '/admin/users');
    await page.getByRole('button', { name: 'Добавить пользователя', exact: true }).click();
    await geometry(page);
  }
});

test('SSR, early typing and no-JavaScript keep the password concealed', async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    locale: info.project.use.locale,
    viewport: info.project.use.viewport,
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const page = await context.newPage();
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() === 'script') await gate;
    await route.continue();
  });
  try {
    await page.goto(base + '/auth/login', { waitUntil: 'commit' });
    const field = page.getByLabel('Пароль', { exact: true });
    await expect(field).toHaveAttribute('type', 'password');
    await expect(eye(field)).toBeDisabled();
    await field.fill(sample);
    release();
    await expect(eye(field)).toBeEnabled();
    await expect(field).toHaveValue(sample);
    await expect(field).toHaveAttribute('type', 'password');
    await eye(field).click();
    await expect(field).toHaveAttribute('type', 'text');
  } finally {
    release();
    await context.close();
  }
  const nojs = await browser.newContext({
    javaScriptEnabled: false,
    locale: info.project.use.locale,
  });
  try {
    const doc = await nojs.newPage();
    await doc.goto(base + '/auth/login');
    const field = doc.getByLabel('Пароль', { exact: true });
    await expect(field).toHaveAttribute('type', 'password');
    await expect(eye(field)).toBeDisabled();
    await doc.goto(base + '/enquiry');
    await expect(doc.getByLabel('Телефон', { exact: true })).toBeVisible();
    if (local) {
      const marker = 'visibility-nojs-' + randomUUID();
      try {
        await doc.getByLabel('Имя родителя', { exact: true }).fill(marker);
        await doc.getByLabel('Телефон', { exact: true }).fill('9000000000');
        await doc.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
        await expect(
          doc.getByRole('heading', { name: 'Заявка принята', exact: true }),
        ).toBeVisible();
      } finally {
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
            `BEGIN; DELETE FROM telegram_outbox WHERE enquiry_id IN (SELECT id FROM enrollment_requests WHERE parent_name='${marker}'); DELETE FROM enquiry_replays WHERE enquiry_id IN (SELECT id FROM enrollment_requests WHERE parent_name='${marker}'); DELETE FROM enrollment_requests WHERE parent_name='${marker}'; COMMIT;`,
          ],
          { stdio: 'pipe' },
        );
      }
    }
  } finally {
    await nojs.close();
  }
});

test('touch toggle keeps the input ready for continued editing', async ({ browser }, info) => {
  const context = await browser.newContext({
    hasTouch: true,
    locale: info.project.use.locale,
    viewport: { width: 375, height: 812 },
  });
  try {
    const page = await context.newPage();
    await page.goto(base + '/auth/login');
    const field = page.getByLabel('Пароль', { exact: true });
    await field.fill(sample);
    await field.evaluate((el: HTMLInputElement) => el.setSelectionRange(3, 3));
    await eye(field).tap();
    await expect(field).toHaveAttribute('type', 'text');
    await expect(field).toBeFocused();
    expect(await field.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(3);
    await page.keyboard.type('X');
    await expect(field).toHaveValue(sample.slice(0, 3) + 'X' + sample.slice(3));
  } finally {
    await context.close();
  }
});
