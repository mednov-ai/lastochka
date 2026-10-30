import { test, expect, type Page, type Locator } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = (process.env.TEST_APP_URL ?? 'http://localhost:5179/lastochka').replace(/\/$/, '');
const output = resolve(process.env.FOCUS_OUTPUT ?? '../artifacts/form-focus/after');
mkdirSync(output, { recursive: true });
const local = base === 'http://localhost:5179/lastochka';

function localSql(query: string) {
  if (!local || process.env.TEST_DATABASE_CONTAINER !== 'lastochka-concept-postgres')
    throw new Error('Isolated acceptance database required');
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
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      query,
    ],
    { stdio: 'pipe' },
  );
}

async function measure(field: Locator) {
  return field.evaluate((node) => {
    const el = node as HTMLInputElement;
    const label = el.labels![0];
    const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    const lines: DOMRect[] = [];
    while (walker.nextNode()) {
      const text = walker.currentNode;
      if (
        !text.textContent?.trim() ||
        text.parentElement?.closest('input,select,textarea,button,.field-error')
      )
        continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      lines.push(...range.getClientRects());
    }
    const control = el.closest('.phone-control') ?? el;
    const rect = control.getBoundingClientRect(),
      style = getComputedStyle(control);
    const offset = parseFloat(style.outlineOffset),
      width = parseFloat(style.outlineWidth);
    const parent = el.closest('.form-card, .workspace-panel')!.getBoundingClientRect();
    const rgba = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
    const lum = (c: number[]) =>
      c
        .slice(0, 3)
        .reduce(
          (sum, v, i) =>
            sum +
            [0.2126, 0.7152, 0.0722][i] *
              (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4),
          0,
        );
    const a = lum(rgba(style.outlineColor)),
      b = lum(rgba(style.backgroundColor));
    const errors = (el.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((e): e is HTMLElement => !!e && !!e.textContent?.trim())
      .map((e) => e.getBoundingClientRect());
    return {
      name: el.name,
      gap: rect.top - offset - width - Math.max(...lines.map((r) => r.bottom)),
      outline: style.outlineStyle,
      width,
      offset,
      focused: document.activeElement === el,
      contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      contained:
        rect.left - offset - width >= parent.left && rect.right + offset + width <= parent.right,
      errorOverlap: errors.some(
        (r) =>
          r.left < rect.right + offset + width &&
          r.right > rect.left - offset - width &&
          r.top < rect.bottom + offset + width &&
          r.bottom > rect.top - offset - width,
      ),
    };
  });
}

async function check(field: Locator) {
  const page = field.page();
  const positions = async () =>
    page
      .locator(
        '.form-card input:not([type=hidden]), .form-card textarea, .form-card button[type=submit], .workspace-panel input, .workspace-panel select',
      )
      .evaluateAll((els) =>
        els
          .filter((el) => el.getClientRects().length)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return [
              r.left,
              r.top +
                scrollY +
                (() => {
                  let offset = 0;
                  for (
                    let parent = el.parentElement;
                    parent && parent !== document.body;
                    parent = parent.parentElement
                  )
                    offset += parent.scrollTop;
                  return offset;
                })(),
              r.width,
              r.height,
            ];
          }),
      );
  await field.scrollIntoViewIfNeeded();
  // Settle scroll and blur first so focus-dependent geometry is actually compared.
  await field.evaluate((el) => (el as HTMLElement).blur());
  const before = await positions();
  await field.focus();
  const after = await positions();
  expect(after.length).toBe(before.length);
  for (let i = 0; i < before.length; i++)
    for (let j = 0; j < 4; j++) expect(Math.abs(after[i][j] - before[i][j])).toBeLessThanOrEqual(1);
  const row = await measure(field);
  expect(row.focused).toBe(true);
  expect(row.outline, JSON.stringify(row)).toBe('solid');
  expect(row.width).toBeGreaterThanOrEqual(2);
  expect(row.gap).toBeGreaterThanOrEqual(2);
  expect(row.contrast).toBeGreaterThanOrEqual(3);
  expect(row.contained).toBe(true);
  expect(row.errorOverlap).toBe(false);
  return row;
}

async function overflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}

async function visit(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('.mobile-menu-toggle')).toBeEnabled();
}

test('login labels remain clear in dialog, direct page, errors and keyboard navigation', async ({
  page,
}, info) => {
  const rows = [];
  await visit(page, base + '/');
  const entry = page.locator('footer .admin-entry');
  await entry.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Логин', { exact: true })).toBeFocused();
  rows.push(await check(dialog.getByLabel('Логин', { exact: true })));
  const tab = info.project.use.browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.keyboard.press(tab);
  await expect(dialog.getByLabel('Пароль', { exact: true })).toBeFocused();
  await page.keyboard.press(
    info.project.use.browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab',
  );
  await expect(dialog.getByLabel('Логин', { exact: true })).toBeFocused();
  await page.screenshot({ path: `${output}/login-${info.project.name}.png` });
  await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(
    dialog.locator('.field-error').filter({ hasText: 'Заполните' }).first(),
  ).toBeVisible();
  rows.push(await check(dialog.getByLabel('Логин', { exact: true })));
  await dialog.getByLabel('Логин', { exact: true }).fill('Проверка');
  await expect(dialog.getByLabel('Логин', { exact: true })).toHaveJSProperty(
    'validationMessage',
    '',
  );
  rows.push(await check(dialog.getByLabel('Пароль', { exact: true })));
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(entry).toBeFocused();
  await visit(page, base + '/auth/login');
  for (const name of ['Логин', 'Пароль'])
    rows.push(await check(page.getByLabel(name, { exact: true })));
  await overflow(page);
  writeFileSync(`${output}/login-${info.project.name}.json`, JSON.stringify(rows, null, 2));
});

test('enquiry fields retain spacing with touch, errors, text enlargement and narrow widths', async ({
  page,
  browser,
}, info) => {
  const rows = [];
  await visit(page, base + '/enquiry');
  const fields = ['Имя родителя', 'Телефон', 'Комментарий — необязательно'];
  for (const name of fields) rows.push(await check(page.getByLabel(name, { exact: true })));
  await page.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
  await expect(page.locator('.field-error').filter({ hasText: 'Заполните' }).first()).toBeVisible();
  rows.push(await check(page.getByLabel('Имя родителя', { exact: true })));
  await page.getByLabel('Имя родителя', { exact: true }).fill('Проверка');
  await expect(page.getByLabel('Имя родителя', { exact: true })).toHaveJSProperty(
    'validationMessage',
    '',
  );
  await page.getByLabel('Телефон', { exact: true }).fill('+7 900 000-00-00');
  await page.getByLabel('Комментарий — необязательно', { exact: true }).fill('Проверка формы');
  for (const name of fields) rows.push(await check(page.getByLabel(name, { exact: true })));
  await page.getByLabel('Имя родителя', { exact: true }).focus();
  const tab = info.project.use.browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  for (const name of fields.slice(1)) {
    await page.keyboard.press(tab);
    if (name === 'Комментарий — необязательно') {
      await expect(
        page.getByRole('button', { name: 'Выбрать занятие', exact: true }),
      ).toBeFocused();
      await page.keyboard.press(tab);
    }
    await expect(page.getByLabel(name, { exact: true })).toBeFocused();
  }
  await page.screenshot({ path: `${output}/enquiry-${info.project.name}.png`, fullPage: true });
  for (const width of [320, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 900 });
    rows.push(await check(page.getByLabel('Телефон', { exact: true })));
    await overflow(page);
  }
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('.form-card label'))
        (el as HTMLElement).style.fontSize = '200%';
    });
    for (const name of fields) rows.push(await check(page.getByLabel(name, { exact: true })));
    await overflow(page);
    await page.screenshot({
      path: `${output}/enquiry-text200-${width}-${info.project.name}.png`,
      fullPage: true,
    });
  }
  const touch = await browser.newContext({
    hasTouch: true,
    viewport: { width: 375, height: 844 },
    reducedMotion: 'reduce',
  });
  const p = await touch.newPage();
  await visit(p, base + '/enquiry');
  await p.getByLabel('Телефон', { exact: true }).tap();
  rows.push(await check(p.getByLabel('Телефон', { exact: true })));
  await p.getByRole('button', { name: 'Отправить заявку', exact: true }).scrollIntoViewIfNeeded();
  await expect(p.getByRole('button', { name: 'Отправить заявку', exact: true })).toBeInViewport();
  await touch.close();
  writeFileSync(`${output}/enquiry-${info.project.name}.json`, JSON.stringify(rows, null, 2));
});

test('admin panels and standalone labels preserve spacing without saving data', async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    viewport: info.project.use.viewport,
    locale: info.project.use.locale,
    ...(process.env.TEST_STORAGE_STATE ? { storageState: process.env.TEST_STORAGE_STATE } : {}),
  });
  if (!process.env.TEST_STORAGE_STATE) {
    localSql(
      "DELETE FROM auth_limits WHERE bucket IN ('login:fixture-admin','login-ip:127.0.0.1')",
    );
    const csrf = await (await context.request.get(base + '/api/v1/auth/csrf')).json();
    const r = await context.request.post(base + '/api/v1/auth/password-stage', {
      headers: { [csrf.headerName]: csrf.token },
      data: { login: 'fixture-admin', password: 'Fixture-pass-123' },
    });
    expect(r.ok()).toBe(true);
  }
  const page = await context.newPage(),
    rows = [];
  await visit(page, base + '/admin/schedule');
  await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
  for (const name of [
    'Название',
    'Формат',
    'Дата занятия · МСК',
    'Начало · МСК',
    'Длительность, минут',
    'Размер группы',
  ])
    rows.push(
      await check(
        name === 'Формат'
          ? page.locator('select[name=format]')
          : page.getByLabel(name, { exact: true }),
      ),
    );
  await overflow(page);
  await page.screenshot({ path: `${output}/schedule-${info.project.name}.png` });
  await page.keyboard.press('Escape');
  await visit(page, base + '/admin/payments');
  await page.getByRole('button', { name: /Создать черновик/ }).click();
  for (const name of ['Сумма в рублях', 'Назначение', 'Имя получателя', 'Телефон'])
    rows.push(await check(page.getByLabel(name, { exact: true })));
  await overflow(page);
  await page.screenshot({ path: `${output}/payment-${info.project.name}.png` });
  await page.keyboard.press('Escape');
  await visit(page, base + '/account/security');
  rows.push(await check(page.getByLabel('Название ключа', { exact: true })));
  await overflow(page);
  await context.close();
  writeFileSync(`${output}/admin-${info.project.name}.json`, JSON.stringify(rows, null, 2));
});

test('static enquiry keeps focus spacing and existing server submission', async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: info.project.use.viewport,
    locale: info.project.use.locale,
  });
  const page = await context.newPage();
  await page.goto(base + '/enquiry');
  const rows = [];
  for (const name of ['Имя родителя', 'Телефон', 'Комментарий — необязательно'])
    rows.push(await check(page.getByLabel(name, { exact: true })));
  await overflow(page);
  if (local) {
    localSql("DELETE FROM auth_limits WHERE bucket='enquiry:127.0.0.1'");
    const marker = 'Фокус noJS ' + info.project.name;
    try {
      await page.getByLabel('Имя родителя', { exact: true }).fill(marker);
      await page.getByLabel('Телефон', { exact: true }).fill('9000000000');
      await page.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Заявка принята', exact: true }),
      ).toBeVisible();
    } finally {
      localSql(
        `BEGIN; DELETE FROM telegram_outbox WHERE enquiry_id IN (SELECT id FROM enrollment_requests WHERE parent_name='${marker}'); DELETE FROM enquiry_replays WHERE enquiry_id IN (SELECT id FROM enrollment_requests WHERE parent_name='${marker}'); DELETE FROM enrollment_requests WHERE parent_name='${marker}'; COMMIT;`,
      );
    }
  }
  await context.close();
  writeFileSync(`${output}/nojs-${info.project.name}.json`, JSON.stringify(rows, null, 2));
});
