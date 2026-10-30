import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = (process.env.TEST_APP_URL ?? 'http://localhost:5179/lastochka').replace(/\/$/, '');
const output = resolve('../artifacts/turquoise');
mkdirSync(output, { recursive: true });

test.beforeEach(() => {
  if (
    process.env.TEST_DATABASE_CONTAINER !== 'lastochka-concept-postgres' ||
    !base.startsWith('http://localhost:5179/')
  )
    throw new Error('Isolated local acceptance database required');
  execFileSync('docker', [
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
    "DELETE FROM auth_limits WHERE bucket IN ('login:fixture-admin','login-ip:127.0.0.1')",
  ]);
});

async function contrast(page: Page, label: string) {
  const rows = await page
    .locator(
      '.header nav a, .header .button, .header .phone, .hero h1, .hero h1 em, .hero .lead, .illustration-label, .eyebrow, .steps li > span, .format-card h3, .format-card .text-link, .coach .lead, .coach-note, footer p, .admin-entry, .form-card label, .form-card input, .workspace-panel label, .workspace-panel input, .workspace-panel .button, .field-error, .form-card .button, .page nav a, .list-card h3, .notice, .muted, .status',
    )
    .evaluateAll((elements) => {
      const rgba = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
      const over = (a: number[], b: number[]) =>
        [0, 1, 2].map((i) => a[i] * (a[3] ?? 1) + b[i] * (1 - (a[3] ?? 1)));
      const luminance = (c: number[]) =>
        c
          .slice(0, 3)
          .reduce(
            (v, x, i) =>
              v +
              [0.2126, 0.7152, 0.0722][i] *
                (x / 255 <= 0.04045 ? x / 255 / 12.92 : ((x / 255 + 0.055) / 1.055) ** 2.4),
            0,
          );
      return elements
        .filter(
          (el) =>
            el.getClientRects().length &&
            (el.textContent?.trim() || el instanceof HTMLInputElement),
        )
        .map((el) => {
          const style = getComputedStyle(el);
          const parents: Element[] = [];
          for (let node: Element | null = el; node; node = node.parentElement)
            parents.unshift(node);
          let bg = [255, 255, 255];
          for (const node of parents) bg = over(rgba(getComputedStyle(node).backgroundColor), bg);
          const fg = over(rgba(style.color), bg);
          const a = luminance(fg),
            b = luminance(bg);
          const large =
            parseFloat(style.fontSize) >= 24 ||
            (parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight) >= 700);
          return {
            text: el.textContent?.trim().slice(0, 60) || 'input',
            color: style.color,
            background: bg,
            ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
            minimum: large ? 3 : 4.5,
          };
        });
    });
  expect(rows.filter((row) => row.ratio + 0.01 < row.minimum)).toEqual([]);
  return { label, rows };
}

test('turquoise brand and coach caption preserve accessible public content', async ({
  page,
  browser,
}, info) => {
  const r = await page.goto(base + '/');
  expect(await r!.text()).not.toContain('Иллюстрация из дизайн-концепции');
  await expect(page.locator('#coach figcaption')).toHaveCount(0);
  await expect(page.locator('#coach img')).toHaveAttribute('alt', 'Иллюстрация тренера');
  await expect(page.locator('.illustration-label')).toHaveCount(0);
  expect(
    await page
      .locator('html')
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--accent').trim()),
  ).toBe('#167f82');
  const reports = [await contrast(page, 'landing')];
  await page.locator('#coach').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/coach-${info.project.name}.png` });
  const ink = page.locator('.format-card .text-link').first();
  await ink.focus();
  reports.push(await contrast(page, 'keyboard focus'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  const button = page.locator('.header .button');
  await button.hover();
  await page.waitForTimeout(70);
  reports.push(await contrast(page, 'hover intermediate'));
  await page.waitForTimeout(200);
  reports.push(await contrast(page, 'hover final'));
  for (const route of ['/#schedule', '/enquiry', '/auth/login']) {
    await page.goto(base + route);
    reports.push(await contrast(page, route));
  }
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.locator('.field-error').filter({ hasText: 'Заполните' }).first()).toBeVisible();
  reports.push(await contrast(page, 'form errors'));
  writeFileSync(
    `${output}/contrast-public-${info.project.name}.json`,
    JSON.stringify(reports, null, 2),
  );
  const svg = readFileSync(resolve('public/images/logo-turquoise.svg'), 'utf8');
  expect(svg).toContain('#168f94');
  expect(svg).toContain('#234b50');
  expect(svg).toContain('#efa238');
  const nojs = await browser.newContext({
    javaScriptEnabled: false,
    viewport: info.project.use.viewport,
    locale: info.project.use.locale,
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const staticPage = await nojs.newPage();
  await staticPage.goto(base + '/');
  await expect(staticPage.locator('#coach figcaption')).toHaveCount(0);
  await expect(staticPage.locator('.brand img')).toHaveAttribute('src', /logo-turquoise.svg$/);
  await staticPage.locator('#coach').scrollIntoViewIfNeeded();
  await staticPage.screenshot({ path: `${output}/coach-nojs-${info.project.name}.png` });
  await nojs.close();
});

test('shared admin routes keep brand colors and readable controls', async ({ page }, info) => {
  const csrf = await (await page.request.get(base + '/api/v1/auth/csrf')).json();
  const r = await page.request.post(base + '/api/v1/auth/password-stage', {
    headers: { [csrf.headerName]: csrf.token },
    data: { login: 'fixture-admin', password: 'Fixture-pass-123' },
  });
  expect(r.ok()).toBe(true);
  const reports = [];
  for (const route of ['/admin/schedule', '/admin/requests', '/admin/payments']) {
    await page.goto(base + route);
    await expect(
      page.locator('.header').getByRole('link', { name: 'Кабинет администратора' }),
    ).toBeVisible();
    reports.push(await contrast(page, route));
    await page.screenshot({ path: `${output}/${route.split('/').pop()}-${info.project.name}.png` });
  }
  await page.goto(base + '/admin/schedule');
  await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  reports.push(await contrast(page, 'admin panel'));
  const border = await page
    .getByLabel('Название', { exact: true })
    .evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(border).toBe('rgb(100, 139, 139)');
  await page.getByRole('button', { name: 'Закрыть панель' }).click();
  await page.goto(base + '/admin/payments');
  await page.getByRole('button', { name: 'Создать черновик оплаты', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Создать платёжную ссылку' })).toBeDisabled();
  reports.push(await contrast(page, 'disabled payment action'));
  await page.getByRole('button', { name: 'Закрыть панель' }).click();
  writeFileSync(
    `${output}/contrast-admin-${info.project.name}.json`,
    JSON.stringify(reports, null, 2),
  );
});
