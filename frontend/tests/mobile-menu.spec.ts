import { test, expect, type Browser, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const base = (process.env.TEST_APP_URL ?? 'http://localhost:5179/lastochka').replace(/\/$/, '');
const output = resolve(process.env.MENU_OUTPUT ?? '../artifacts/mobile-menu');
mkdirSync(output, { recursive: true });
const widths = [320, 374, 375, 390, 393, 402, 414, 430, 431, 440, 768, 1000, 1001, 1440];
const links = [
  ['О занятиях', 'approach'],
  ['Форматы', 'formats'],
  ['Тренер', 'coach'],
  ['Контакты', 'contacts'],
  ['Расписание', 'schedule'],
] as const;

async function contextFor(browser: Browser, admin: boolean, locale: string, width: number) {
  const context = await browser.newContext({
    locale,
    viewport: { width, height: 844 },
    ...(admin && process.env.TEST_STORAGE_STATE
      ? { storageState: process.env.TEST_STORAGE_STATE }
      : {}),
  });
  if (admin && !process.env.TEST_STORAGE_STATE) {
    if (
      base !== 'http://localhost:5179/lastochka' ||
      process.env.TEST_DATABASE_CONTAINER !== 'lastochka-concept-postgres'
    )
      throw Error('Isolated acceptance database required');
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
    const response = await context.request.post(base + '/api/v1/auth/password-stage', {
      headers: { [csrf.headerName]: csrf.token },
      data: { login: 'fixture-admin', password: 'Fixture-pass-123' },
    });
    expect(response.ok()).toBe(true);
  }
  return context;
}

async function layout(page: Page) {
  const result = await page.locator('.header').evaluate((header) => {
    const r = header.getBoundingClientRect();
    const controls = [
      header.querySelector('.brand'),
      header.querySelector('.header-actions .button'),
      [...header.querySelectorAll('.mobile-menu-toggle, .mobile-menu-fallback summary')].find(
        (element) => element.getClientRects().length,
      ),
    ]
      .filter((el): el is Element => !!el && !!el.getClientRects().length)
      .map((el) => el.getBoundingClientRect());
    return {
      height: r.height,
      top: r.top,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      outside: controls.some((c) => c.left < 0 || c.right > innerWidth + 1),
      overlap: controls.some((a, i) =>
        controls
          .slice(i + 1)
          .some(
            (b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top,
          ),
      ),
      targets: controls.slice(1).every((c) => c.width >= 44 && c.height >= 44),
      logo: header.querySelector('img')!.getBoundingClientRect().width,
      centerSpread:
        Math.max(...controls.map((c) => c.y + c.height / 2)) -
        Math.min(...controls.map((c) => c.y + c.height / 2)),
      fontSize: parseFloat(
        getComputedStyle(header.querySelector('.header-actions .button')!).fontSize,
      ),
    };
  });
  expect(result.overflow).toBe(false);
  expect(result.outside).toBe(false);
  expect(result.overlap).toBe(false);
  expect(result.targets).toBe(true);
  return result;
}

async function targetVisible(page: Page, id: string) {
  await expect
    .poll(async () =>
      page
        .locator('#' + id)
        .evaluate((el) =>
          Math.min(
            el.getBoundingClientRect().top -
              document.querySelector('.header')!.getBoundingClientRect().bottom,
            innerHeight - 1 - el.getBoundingClientRect().top,
          ),
        ),
    )
    .toBeGreaterThanOrEqual(-1);
}

async function contrast(page: Page) {
  const rows = await page
    .locator('.mobile-menu-toggle, .mobile-navigation a')
    .evaluateAll((elements) => {
      const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
      const luminance = (c: number[]) =>
        c
          .slice(0, 3)
          .reduce(
            (sum, v, i) =>
              sum +
              [0.2126, 0.7152, 0.0722][i] *
                (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4),
            0,
          );
      const ratio = (a: number[], b: number[]) => {
        const x = luminance(a),
          y = luminance(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      return elements
        .filter((el) => el.getClientRects().length)
        .map((el) => {
          const style = getComputedStyle(el);
          let node: Element | null = el,
            bg = [255, 255, 255];
          while (node) {
            const color = rgb(getComputedStyle(node).backgroundColor);
            if ((color[3] ?? 1) > 0) {
              bg = color;
              break;
            }
            node = node.parentElement;
          }
          return {
            text: el.textContent!.trim(),
            textContrast: ratio(rgb(style.color), bg),
            indicatorContrast: ratio(rgb(style.outlineColor), bg),
          };
        });
    });
  expect(rows.length).toBe(6);
  for (const row of rows) {
    expect(row.textContrast).toBeGreaterThanOrEqual(4.5);
    expect(row.indicatorContrast).toBeGreaterThanOrEqual(3);
  }
  return rows;
}

test('guest and admin headers fit breakpoints with an accessible collapsed menu', async ({
  browser,
}, info) => {
  const rows = [],
    contrasts = [];
  for (const admin of [false, true]) {
    const context = await contextFor(
      browser,
      admin,
      info.project.use.locale!,
      info.project.use.viewport!.width,
    );
    const page = await context.newPage();
    await page.goto(base + '/');
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      const row = await layout(page);
      rows.push({ admin, width, ...row });
      if (width <= 1000) {
        expect(row.height).toBeLessThanOrEqual(width < 375 ? 160 : 104);
        expect(row.logo).toBeGreaterThanOrEqual(150);
        expect(row.fontSize).toBeGreaterThanOrEqual(16);
        if (width >= 375) expect(row.centerSpread).toBeLessThanOrEqual(2);
        await expect(page.locator('.mobile-menu-toggle')).toHaveText('');
        await expect(page.getByRole('button', { name: 'Меню', exact: true })).toHaveAttribute(
          'aria-expanded',
          'false',
        );
        await expect(page.getByRole('navigation', { name: 'Навигация по разделам' })).toHaveCount(
          0,
        );
      } else {
        await expect(page.getByRole('button', { name: 'Меню', exact: true })).toHaveCount(0);
        await expect(
          page.getByRole('navigation', { name: 'Основная навигация' }).getByRole('link'),
        ).toHaveCount(5);
      }
      if ([375, 414, 430, 1440].includes(width))
        await page.screenshot({
          path: `${output}/closed-${info.project.name}-${admin}-${width}.png`,
        });
    }
    await page.setViewportSize({ width: 375, height: 844 });
    await expect(page.locator('.header-actions .button')).toHaveText(
      admin ? /Кабинет/ : /Записаться/,
    );
    const menu = page.getByRole('button', { name: 'Меню', exact: true });
    await menu.click();
    const nav = page.getByRole('navigation', { name: 'Навигация по разделам' });
    await expect(nav.getByRole('link')).toHaveText(links.map(([name]) => name));
    contrasts.push({ admin, rows: await contrast(page) });
    await expect(menu).toHaveAttribute('aria-controls', (await nav.getAttribute('id')) ?? '');
    await page.screenshot({ path: `${output}/open-${info.project.name}-${admin}.png` });
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await context.close();
  }
  writeFileSync(`${output}/geometry-${info.project.name}.json`, JSON.stringify(rows, null, 2));
  writeFileSync(`${output}/contrast-${info.project.name}.json`, JSON.stringify(contrasts, null, 2));
});

test('all section links work from public and admin routes including a repeated hash', async ({
  browser,
}, info) => {
  for (const admin of [false, true]) {
    const context = await contextFor(browser, admin, info.project.use.locale!, 375),
      page = await context.newPage();
    for (const origin of ['/', '/enquiry', ...(admin ? ['/admin/schedule'] : [])])
      for (const [name, id] of links) {
        await page.goto(base + origin);
        await page.getByRole('button', { name: 'Меню', exact: true }).click();
        await page
          .getByRole('navigation', { name: 'Навигация по разделам' })
          .getByRole('link', { name, exact: true })
          .click();
        await expect(page).toHaveURL(base + '/#' + id);
        await expect(page.getByRole('button', { name: 'Меню', exact: true })).toHaveAttribute(
          'aria-expanded',
          'false',
        );
        await targetVisible(page, id);
      }
    await page.goto(base + '/#coach');
    for (let repeat = 0; repeat < 2; repeat++) {
      await page.getByRole('button', { name: 'Меню', exact: true }).click();
      await page
        .getByRole('navigation', { name: 'Навигация по разделам' })
        .getByRole('link', { name: 'Тренер', exact: true })
        .click();
      await targetVisible(page, 'coach');
    }
    await context.close();
  }
});

test('keyboard, outside activation, resize and modal focus close the menu naturally', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto(base + '/');
  const menu = page.getByRole('button', { name: 'Меню', exact: true });
  const tab = info.project.use.browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await expect(menu).toBeEnabled();
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press(tab);
  await expect(
    page.getByRole('navigation', { name: 'Навигация по разделам' }).getByRole('link').first(),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Space');
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.locator('.hero-cta .button').first().click();
  await expect(page).toHaveURL(base + '/enquiry');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await page.getByLabel('Имя родителя', { exact: true }).click();
  await expect(page.getByLabel('Имя родителя', { exact: true })).toBeFocused();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await page
    .getByRole('navigation', { name: 'Навигация по разделам' })
    .getByRole('link')
    .first()
    .focus();
  await page.setViewportSize({ width: 1001, height: 844 });
  await expect(page.locator('.brand')).toBeFocused();
  await page.setViewportSize({ width: 1000, height: 844 });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await page.locator('.header-actions .button').click();
  await expect(page).toHaveURL(base + '/enquiry');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.focus();
  await page.keyboard.press('Enter');
  for (let i = 0; i < 8; i++) await page.keyboard.press(tab);
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await page.goto(base + '/');
  await menu.click();
  await page.locator('footer .admin-entry').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Escape');
  await expect(page.locator('footer .admin-entry')).toBeFocused();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  for (const size of [
    { width: 320, height: 568 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
    await layout(page);
    await menu.click();
    const last = page
      .getByRole('navigation', { name: 'Навигация по разделам' })
      .getByRole('link')
      .last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await page.screenshot({ path: `${output}/text200-${info.project.name}-${size.width}.png` });
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
    await page.evaluate(() => (document.documentElement.style.fontSize = ''));
  }
  expect(errors).toEqual([]);
});

test('native no-JS menu and touch reduced-motion retain every destination', async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    locale: info.project.use.locale,
    viewport: { width: 375, height: 568 },
  });
  const page = await context.newPage();
  const noJsRows = [];
  for (const admin of [false, true]) {
    const authContext = admin
      ? await contextFor(browser, true, info.project.use.locale!, 375)
      : null;
    const nativeContext = await browser.newContext({
      javaScriptEnabled: false,
      locale: info.project.use.locale,
      viewport: { width: 375, height: 844 },
      ...(authContext ? { storageState: await authContext.storageState() } : {}),
    });
    const native = await nativeContext.newPage();
    await native.goto(base + '/');
    for (const width of widths) {
      await native.setViewportSize({ width, height: 844 });
      const row = await layout(native);
      noJsRows.push({ admin, width, ...row });
      if (width <= 1000) {
        expect(row.height).toBeLessThanOrEqual(width < 375 ? 160 : 104);
        expect(row.logo).toBeGreaterThanOrEqual(150);
        expect(row.fontSize).toBeGreaterThanOrEqual(16);
        if (width >= 375) expect(row.centerSpread).toBeLessThanOrEqual(2);
        await expect(native.locator('.mobile-menu-fallback summary')).toHaveAccessibleName('Меню');
        await expect(native.locator('.mobile-menu-fallback summary')).toHaveText('');
        // AuthProvider resolves the session in the client; SSR/no-JS retains the public CTA.
        await expect(native.locator('.header-actions .button')).toHaveText(/Записаться/);
      } else await expect(native.locator('.mobile-menu-fallback summary')).toBeHidden();
      if ([375, 414, 430].includes(width))
        await native.screenshot({
          path: `${output}/nojs-closed-${info.project.name}-${admin}-${width}.png`,
        });
    }
    await native.setViewportSize({ width: 375, height: 568 });
    const summary = native.locator('.mobile-menu-fallback summary');
    await summary.focus();
    await native.keyboard.press('Enter');
    await expect(native.locator('.mobile-menu-fallback')).toHaveAttribute('open', '');
    await native.keyboard.press('Space');
    await expect(native.locator('.mobile-menu-fallback')).not.toHaveAttribute('open');
    await native.locator('.brand').focus();
    const tab = info.project.use.browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    await native.keyboard.press(tab);
    await expect(native.locator('.header-actions .button')).toBeFocused();
    await native.keyboard.press(tab);
    await expect(summary).toBeFocused();
    await native.evaluate(() => (document.documentElement.style.fontSize = '200%'));
    await layout(native);
    await summary.click();
    const last = native
      .getByRole('navigation', { name: 'Навигация по разделам' })
      .getByRole('link')
      .last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await nativeContext.close();
    await authContext?.close();
  }
  writeFileSync(
    `${output}/geometry-nojs-${info.project.name}.json`,
    JSON.stringify(noJsRows, null, 2),
  );
  for (const origin of ['/', '/enquiry'])
    for (const [name, id] of links) {
      await page.goto(base + origin);
      const summary = page.locator('.mobile-menu-fallback summary');
      await summary.click();
      const nav = page.getByRole('navigation', { name: 'Навигация по разделам' });
      await expect(nav.getByRole('link')).toHaveCount(5);
      await nav.getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(base + '/#' + id);
      if ((await page.locator('.mobile-menu-fallback').getAttribute('open')) !== null) {
        // Click the visible sticky summary without automation scrolling it to its original document position.
        const box = await summary.boundingBox();
        expect(box).not.toBeNull();
        await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      }
      await targetVisible(page, id);
    }
  for (const size of [
    { width: 320, height: 568 },
    { width: 431, height: 568 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(base + '/');
    expect((await layout(page)).height).toBeLessThanOrEqual(160);
    await page.locator('.mobile-menu-fallback summary').click();
    const last = page
      .getByRole('navigation', { name: 'Навигация по разделам' })
      .getByRole('link')
      .last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await page.screenshot({ path: `${output}/nojs-${info.project.name}-${size.width}.png` });
  }
  await context.close();
  const touch = await browser.newContext({
    hasTouch: true,
    reducedMotion: 'reduce',
    viewport: { width: 375, height: 844 },
  });
  const p = await touch.newPage();
  await p.goto(base + '/');
  await p.getByRole('button', { name: 'Меню', exact: true }).tap();
  await p
    .getByRole('navigation', { name: 'Навигация по разделам' })
    .getByRole('link', { name: 'Расписание', exact: true })
    .tap();
  await expect(p).toHaveURL(base + '/#schedule');
  await expect(p.getByRole('button', { name: 'Меню', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await touch.close();
});
