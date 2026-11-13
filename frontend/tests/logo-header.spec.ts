import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const base = (process.env.TEST_APP_URL ?? 'http://localhost:5179/lastochka').replace(/\/$/, '');
const output = resolve('../artifacts/turquoise/header');
mkdirSync(output, { recursive: true });

test.beforeEach(() => {
  if (
    process.env.TEST_DATABASE_CONTAINER !== 'lastochka-concept-postgres' ||
    !base.startsWith('http://localhost:5179/')
  )
    throw new Error('Use the isolated concept acceptance database and local preview');
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

async function geometry(page: Page) {
  await page.locator('.brand img').evaluate((image: HTMLImageElement) => image.decode());
  const result = await page.locator('.header').evaluate((header) => {
    const box = header.getBoundingClientRect();
    const children = [...header.querySelectorAll('a, img')]
      .filter((node) => !node.closest('details:not([open])'))
      .map((node) => ({ node, box: node.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0);
    const logo = header.querySelector('img')!.getBoundingClientRect();
    return {
      height: box.height,
      logoWidth: logo.width,
      ratio: logo.width / logo.height,
      outside: children.filter(
        ({ box: r }) => r.left < -1 || r.right > innerWidth + 1 || r.bottom > box.bottom + 1,
      ).length,
      overlaps: children.filter(
        ({ node, box: r }) =>
          !node.closest('.brand') &&
          r.left < logo.right &&
          r.right > logo.left &&
          r.top < logo.bottom &&
          r.bottom > logo.top,
      ).length,
    };
  });
  expect(result.outside).toBe(0);
  expect(result.overlaps).toBe(0);
  expect(result.ratio).toBeCloseTo(600 / 195, 1);
  return result;
}

test('vector logo and header retain navigation across guest and admin widths', async ({
  page,
}, info) => {
  await page.goto(base + '/');
  const svg = await page.request.get(base + '/images/logo-turquoise.svg');
  expect(svg.ok()).toBe(true);
  expect(svg.headers()['content-type']).toContain('image/svg+xml');
  expect(await svg.text()).not.toMatch(/<(?:image|script|foreignObject|text)\b|href=|data:image/i);
  expect(await svg.text()).toBe(readFileSync(resolve('public/images/logo-turquoise.svg'), 'utf8'));

  const initial = await geometry(page);
  if (info.project.use.viewport!.width === 375) {
    expect(initial.height).toBeLessThanOrEqual(104);
    expect(initial.logoWidth).toBeGreaterThanOrEqual(150);
  } else {
    // polish-public-site-per-client-review: one compact row instead of the enlarged header.
    expect(initial.height).toBeLessThanOrEqual(104);
    expect(initial.logoWidth).toBeGreaterThanOrEqual(168);
  }
  await expect(
    page.locator('.header').getByRole('link', { name: 'Войти', exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: `${output}/after-${info.project.name}.png` });
  const tab = info.project.use.browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.keyboard.press(tab);
  await expect(page.getByRole('link', { name: 'К содержимому' })).toBeFocused();
  await page.keyboard.press(tab);
  await expect(page.locator('.brand')).toBeFocused();

  await page
    .locator('footer')
    .getByRole('link', { name: 'Для администратора', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Логин', { exact: true }).fill('fixture-admin');
  await dialog.getByLabel('Пароль', { exact: true }).fill('wrong');
  await dialog.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(dialog.getByRole('alert').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator('footer').getByRole('link', { name: 'Для администратора', exact: true }),
  ).toBeFocused();
  await page
    .locator('.header')
    .getByRole('link', { name: /Записаться/ })
    .click();
  await expect(page.getByRole('heading', { name: 'Заявка на занятие' })).toBeVisible();
  await page.keyboard.press('Escape');

  const csrf = await (await page.request.get(base + '/api/v1/auth/csrf')).json();
  const login = await page.request.post(base + '/api/v1/auth/password-stage', {
    headers: { [csrf.headerName]: csrf.token },
    data: { login: 'fixture-admin', password: 'Fixture-pass-123' },
  });
  expect(login.ok()).toBe(true);
  await page.reload();
  await expect(
    page.locator('.header').getByRole('link', { name: /Кабинет администратора/ }),
  ).toBeVisible();
  for (const width of [
    320, 375, 390, 599, 600, 601, 679, 680, 681, 768, 999, 1000, 1001, 1024, 1440, 1920,
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    const box = await geometry(page);
    if (width <= 1000) expect(box.height).toBeLessThanOrEqual(width < 375 ? 160 : 104);
  }
  await page.setViewportSize(info.project.use.viewport!);
  await page.screenshot({ path: `${output}/after-admin-${info.project.name}.png` });
  for (const route of ['/#schedule', '/enquiry', '/admin/schedule']) {
    await page.goto(base + route);
    await geometry(page);
    await page.locator('.brand').click();
    await expect(page).toHaveURL(base + '/');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await geometry(page);
  await page.locator('.brand img').evaluate((image) => {
    image.style.width = '200%';
    image.style.maxWidth = 'none';
  });
  // Vector detail at 200% is recorded separately from responsive layout.
  await page.locator('.brand img').screenshot({ path: `${output}/zoom-${info.project.name}.png` });
});

test('logo and public actions work without JavaScript and on touch', async ({ browser }, info) => {
  const context = await browser.newContext({
    viewport: info.project.use.viewport,
    locale: info.project.use.locale,
    javaScriptEnabled: false,
    deviceScaleFactor: 2,
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto(base + '/');
  await geometry(page);
  if (info.project.use.viewport!.width <= 1000) {
    for (const y of [1200, 100000, 400, 0]) {
      await page.evaluate((y) => scrollTo(0, y), y);
      expect(
        await page.locator('.header').evaluate((h) => h.getBoundingClientRect().top),
      ).toBeCloseTo(0, 0);
    }
    await page.goto(base + '/#formats');
    expect(
      await page.locator('#formats').evaluate((el) => el.getBoundingClientRect().top),
    ).toBeGreaterThanOrEqual(80);
  }
  await page.screenshot({ path: `${output}/nojs-dpr2-${info.project.name}.png` });
  if (info.project.use.viewport!.width <= 1000) {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await geometry(page);
    await page.getByRole('link', { name: 'Как проходят занятия' }).click();
    const headerBottom = await page
      .locator('.header')
      .evaluate((el) => el.getBoundingClientRect().bottom);
    expect(
      await page.locator('#approach').evaluate((el) => el.getBoundingClientRect().top),
    ).toBeGreaterThanOrEqual(headerBottom);
    await page.screenshot({ path: `${output}/nojs-text-200-${info.project.name}.png` });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
  }
  await page
    .locator('.header')
    .getByRole('link', { name: /Записаться/ })
    .tap();
  await expect(page).toHaveURL(base + '/enquiry');
  await expect(page.getByRole('heading', { name: 'Заявка на занятие' })).toBeVisible();
  await page.locator('.brand').tap();
  await expect(page).toHaveURL(base + '/');
  await context.close();
});

test('sticky header keeps anchors, enlarged text and focused fields visible', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 375, height: 568 });
  await page.goto(base + '/#formats');
  await expect
    .poll(() => page.locator('#formats').evaluate((el) => el.getBoundingClientRect().top))
    .toBeGreaterThanOrEqual(80);
  for (const y of [2000, 100000, 800, 0]) {
    await page.evaluate((y) => scrollTo(0, y), y);
    expect(
      await page.locator('.header').evaluate((el) => el.getBoundingClientRect().top),
    ).toBeCloseTo(0, 0);
    await geometry(page);
  }
  await page.screenshot({ path: `${output}/sticky-${info.project.name}.png` });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => scrollTo(0, 900));
  expect(
    await page.locator('.header').evaluate((el) => el.getBoundingClientRect().top),
  ).toBeCloseTo(0, 0);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  await geometry(page);
  await page.locator('.header .button').click();
  await expect(page.getByRole('heading', { name: 'Заявка на занятие' })).toBeVisible();
  await page.getByLabel('Имя родителя').focus();
  await expect
    .poll(() => page.getByLabel('Имя родителя').evaluate((el) => el.getBoundingClientRect().top))
    .toBeGreaterThanOrEqual(80);
  await page.screenshot({ path: `${output}/text-200-${info.project.name}.png` });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await page.goto(base + '/');
  await page.locator('footer .admin-entry').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const close = page.getByRole('button', { name: 'Закрыть окно входа' });
  await expect(close).toBeVisible();
  await page.setViewportSize({ width: 375, height: 390 });
  await expect(close).toBeVisible();
  await close.click();
  await expect(page.locator('footer .admin-entry')).toBeFocused();
  await page.goto(base + '/auth/login');
  await expect(page.getByRole('heading', { name: 'Вход администратора' })).toBeVisible();
});

test('header highlights smoothly and supports reduced motion and keyboard focus', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/');
  const link = page.locator('.header nav a').first();
  expect(await link.evaluate((el) => getComputedStyle(el).fontSize)).toBe('18px');
  expect(await page.locator('.header .phone').evaluate((el) => getComputedStyle(el).fontSize)).toBe(
    '16px',
  );
  expect(
    await page.locator('.header .button').evaluate((el) => getComputedStyle(el).fontSize),
  ).toBe('16px');
  const read = () =>
    link.evaluate((el) => ({
      background: getComputedStyle(el).backgroundColor,
      line: getComputedStyle(el, '::after').transform,
      width: el.getBoundingClientRect().width,
    }));
  const before = await read();
  await link.hover();
  await page.waitForTimeout(70);
  const middle = await read();
  await page.screenshot({ path: `${output}/hover-mid-${info.project.name}.png` });
  await page.waitForTimeout(220);
  const end = await read();
  expect(middle.background).not.toBe(before.background);
  expect(middle.line).not.toBe(end.line);
  expect(end.width).toBe(before.width);
  await page.mouse.move(0, 800);
  await page.waitForTimeout(250);
  expect((await read()).background).toBe(before.background);
  await link.focus();
  expect(await link.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await link.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
  const button = page.locator('.header .button');
  await button.hover();
  expect(await button.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
});
