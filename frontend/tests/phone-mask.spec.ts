import { test, expect, type Locator, type Browser, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const base = (process.env.TEST_APP_URL ?? 'http://localhost:5179/lastochka').replace(/\/$/, '');
const output = process.env.PHONE_OUTPUT ?? '../artifacts/phone-mask/browser';
mkdirSync(output, { recursive: true });
async function select(field: Locator, start: number, end = start) {
  await field.evaluate(
    (el, [a, b]) => (el as HTMLInputElement).setSelectionRange(a, b),
    [start, end],
  );
}
async function paste(field: Locator, text: string) {
  await field.evaluate((el, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    el.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }),
    );
  }, text);
}
async function adminContext(
  browser: Browser,
  locale: string,
  width: number,
): Promise<BrowserContext> {
  const context = await browser.newContext({
    locale,
    viewport: { width, height: 1000 },
    ...(process.env.TEST_STORAGE_STATE ? { storageState: process.env.TEST_STORAGE_STATE } : {}),
  });
  if (!process.env.TEST_STORAGE_STATE) {
    if (
      base !== 'http://localhost:5179/lastochka' ||
      process.env.TEST_DATABASE_CONTAINER !== 'lastochka-concept-postgres'
    )
      throw Error('Isolated database required');
    execFileSync(
      'docker',
      [
        'exec',
        'lastochka-concept-postgres',
        'psql',
        '-U',
        'lastochka',
        '-d',
        'lastochka_concept',
        '-c',
        "DELETE FROM auth_limits WHERE bucket IN ('login:fixture-admin','login-ip:127.0.0.1')",
      ],
      { stdio: 'pipe' },
    );
    const csrf = await (await context.request.get(base + '/api/v1/auth/csrf')).json();
    expect(
      (
        await context.request.post(base + '/api/v1/auth/password-stage', {
          headers: { [csrf.headerName]: csrf.token },
          data: { login: 'fixture-admin', password: 'Fixture-pass-123' },
        })
      ).ok(),
    ).toBe(true);
  }
  return context;
}

test('fixed prefix, live mask, editing, clipboard, autofill and history', async ({
  page,
}, info) => {
  await page.goto(base + '/enquiry');
  const field = page.getByLabel('Телефон', { exact: true });
  await expect(page.locator('.phone-control')).toHaveAttribute('data-enhanced', 'true');
  await field.focus();
  await expect(field).toHaveValue('');
  await expect(page.locator('.phone-mask')).toHaveText('___ ___-__-__');
  await field.pressSequentially('9001');
  await expect(field).toHaveValue('900 1');
  await expect(page.locator('.phone-mask')).toHaveText('900 1__-__-__');
  await field.pressSequentially('2345678a');
  await expect(field).toHaveValue('900 123-45-67');
  await select(field, 0);
  await field.press('Backspace');
  await expect(field).toHaveValue('900 123-45-67');
  await select(field, 4, 5);
  await field.press('9');
  await expect(field).toHaveValue('900 923-45-67');
  expect(await field.evaluate((el) => (el as HTMLInputElement).selectionStart)).toBe(5);
  await field.press('ControlOrMeta+z');
  await expect(field).toHaveValue('900 123-45-67');
  await field.press('ControlOrMeta+Shift+z');
  await expect(field).toHaveValue('900 923-45-67');
  await select(field, 4);
  await field.press('Backspace');
  await expect(field).toHaveValue('909 234-56-7');
  await select(field, 3);
  await field.press('Delete');
  await expect(field).toHaveValue('909 345-67');
  for (const value of [
    '9001234567',
    '+79001234567',
    '79001234567',
    '8 (900) 123-45-67',
    '+7\u00a0900\u00a0123-45-67',
  ]) {
    await select(field, 0, 99);
    await paste(field, value);
    await expect(field).toHaveValue('900 123-45-67');
  }
  for (const value of ['7900123456', '8900123456']) {
    await select(field, 0, 99);
    await paste(field, value);
    await expect(field).toHaveValue(
      value.substring(0, 3) +
        ' ' +
        value.substring(3, 6) +
        '-' +
        value.substring(6, 8) +
        '-' +
        value.substring(8),
    );
  }
  await field.fill('9001234567');
  for (const value of ['+790012345678', '+49001234567', '900abc1234567']) {
    await select(field, 0, 99);
    await paste(field, value);
    await expect(field).toHaveValue('900 123-45-67');
    await expect(page.getByRole('status').filter({ hasText: 'Лишние цифры' })).toBeVisible();
  }
  await select(field, 4, 5);
  await paste(field, '8');
  await expect(field).toHaveValue('900 823-45-67');
  await expect(page.getByRole('status').filter({ hasText: 'Лишние цифры' })).toHaveCount(0);
  await select(field, 4);
  await paste(field, '99');
  await expect(field).toHaveValue('900 823-45-67');
  // Real input/change event paths used by autofill, without keyboard events.
  await field.evaluate((el) => {
    const f = el as HTMLInputElement;
    f.value = '8 (900) 123-45-67';
    f.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(field).toHaveValue('900 123-45-67');
  await field.evaluate((el) => {
    const f = el as HTMLInputElement;
    f.value = '+790012345678';
    f.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(field).toHaveValue('900 123-45-67');
  await select(field, 0, 99);
  await field.press('Backspace');
  await expect(field).toHaveValue('');
  await expect(page.locator('.phone-prefix')).toHaveText('+7');
  await field.pressSequentially('9001234567');
  expect(await field.evaluate((el) => (el as HTMLInputElement).validity.valid)).toBe(true);
  await field.screenshot({ path: `${output}/${info.project.name}-phone.png` });
});

test('Russian completeness errors, Enter and accessible layout', async ({ page }, info) => {
  await page.goto(base + '/enquiry');
  const field = page.getByLabel('Телефон', { exact: true });
  await page.getByLabel('Имя родителя').fill('Проверка');
  for (const method of ['button', 'enter']) {
    await field.fill('900123456');
    if (method === 'button') await page.getByRole('button', { name: 'Отправить заявку' }).click();
    else await field.press('Enter');
    await expect(page.locator('.form-validation')).toContainText(
      'Введите 10 цифр телефона после +7.',
    );
    expect(await field.getAttribute('aria-invalid')).toBe('true');
    await field.press('7');
    await expect(field).toHaveValue('900 123-45-67');
    await expect(page.locator('.form-validation')).toHaveCount(0);
  }
  for (const width of [320, 375, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await field.focus();
    for (const scale of [1, 2]) {
      await page.evaluate((s) => (document.documentElement.style.fontSize = `${s * 100}%`), scale);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const layout = await field.evaluate((el) => {
        const frame = el.closest('.phone-control')!,
          r = frame.getBoundingClientRect(),
          style = getComputedStyle(frame);
        const label = (el as HTMLInputElement).labels![0].getBoundingClientRect();
        return {
          gap: r.top - label.bottom,
          outline: style.outlineWidth,
          right: r.right,
          left: r.left,
        };
      });
      expect(layout.gap).toBeGreaterThanOrEqual(12);
      expect(layout.outline).toBe('2px');
      expect(layout.left).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(width);
    }
    await page.evaluate(() => (document.documentElement.style.fontSize = ''));
  }
  await page.setViewportSize(info.project.use.viewport!);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.screenshot({ path: `${output}/${info.project.name}-form.png`, fullPage: true });
});

test('payment draft uses same mask and preserves canonical payload on errors', async ({
  browser,
}, info) => {
  const context = await adminContext(
    browser,
    info.project.use.locale!,
    info.project.use.viewport!.width,
  );
  const page = await context.newPage();
  await page.goto(base + '/admin/payments');
  await page.getByRole('button', { name: 'Создать черновик оплаты', exact: true }).click();
  const field = page.getByLabel('Телефон', { exact: true });
  await expect(page.locator('.phone-control')).toHaveAttribute('data-enhanced', 'true');
  await field.fill('+79001234567');
  await expect(field).toHaveValue('900 123-45-67');
  await page.getByLabel('Сумма в рублях').fill('123.45');
  await page.getByLabel('Назначение', { exact: true }).fill('Проверка маски');
  await page.getByLabel('Имя получателя').fill('Проверка');
  let sent = '';
  await page.route('**/api/v1/admin/payment-requests', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    sent = route.request().postDataJSON().phone;
    await route.fulfill({
      status: 409,
      contentType: 'application/problem+json',
      body: JSON.stringify({ detail: 'Черновик изменён. Обновите данные.', fieldErrors: {} }),
    });
  });
  await page.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect.poll(() => sent).toBe('+79001234567');
  await expect(field).toHaveValue('900 123-45-67');
  await field.fill('900');
  await field.press('Enter');
  await expect(page.locator('.form-validation')).toContainText('10 цифр');
  await context.close();
});

test('SSR national digits and late hydration preserve early input', async ({ browser }, info) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    locale: info.project.use.locale,
    viewport: info.project.use.viewport,
  });
  const page = await context.newPage();
  await page.goto(base + '/enquiry');
  const field = page.getByLabel('Телефон', { exact: true });
  await expect(page.locator('.phone-prefix')).toHaveText('+7');
  await expect(field).toHaveAttribute('maxlength', '10');
  await field.fill('9001234567');
  expect(await field.evaluate((el) => (el as HTMLInputElement).checkValidity())).toBe(true);
  await context.close();
  const late = await browser.newContext({
    locale: info.project.use.locale,
    viewport: info.project.use.viewport,
  });
  const p = await late.newPage();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await p.route('**/assets/*.js', async (route) => {
    await gate;
    await route.continue();
  });
  await p.goto(base + '/enquiry', { waitUntil: 'domcontentloaded' });
  const f = p.getByLabel('Телефон', { exact: true });
  await f.fill('900123');
  release();
  await expect(p.locator('.phone-control')).toHaveAttribute('data-enhanced', 'true');
  await expect(f).toHaveValue('900 123');
  await f.pressSequentially('4567');
  await expect(f).toHaveValue('900 123-45-67');
  await late.close();
});
