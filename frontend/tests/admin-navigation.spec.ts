import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = 'http://localhost:18142/lastochka';
const paths = [
  '/admin/schedule',
  '/admin/requests',
  '/admin/payments',
  '/admin/users',
  '/account/security',
];
const widths = [320, 374, 375, 430, 768, 1000, 1001, 1024, 1280, 1440, 1920];
const output = '../artifacts/admin-navigation-20261029';

test.beforeEach(async ({ context }) => {
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
  const token = await (await context.request.get(`${base}/api/v1/auth/csrf`)).json();
  const response = await context.request.post(`${base}/api/v1/auth/password-stage`, {
    headers: { [token.headerName]: token.token, Origin: 'http://localhost:18142' },
    data: { login: 'entry-fixture', password: 'Fixture-pass-123' },
  });
  expect(response.ok()).toBeTruthy();
  mkdirSync(output, { recursive: true });
});

async function header(page: Page) {
  const button = page.locator('.header').getByRole('button', { name: 'Выйти', exact: true });
  await expect(button).toBeVisible();
  return button;
}

async function geometry(page: Page) {
  return page.locator('.workspace-navigation').evaluate((nav) => {
    const rect = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      width: innerWidth,
      overflow: document.documentElement.scrollWidth - innerWidth,
      nav: rect(nav),
      links: [...nav.querySelectorAll('a')].map((link) => {
        const range = document.createRange();
        range.selectNodeContents(link);
        const text = range.getBoundingClientRect();
        const style = getComputedStyle(link);
        const box = link.getBoundingClientRect();
        return {
          ...rect(link),
          radius: style.borderRadius,
          text: link.textContent,
          dx: Math.abs(text.x + text.width / 2 - (box.x + box.width / 2)),
          dy: Math.abs(text.y + text.height / 2 - (box.y + box.height / 2)),
          foreground: style.color,
          background: style.backgroundColor,
          border: style.borderColor,
          outline: style.outlineColor,
          surface: getComputedStyle(document.documentElement).backgroundColor,
        };
      }),
    };
  });
}

function contrast(first: string, second: string) {
  const luminance = (color: string) => {
    const values = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number);
    return values
      .map((value) => value / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
      .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
  };
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('прямоугольные ссылки центрированы на всех размерах и при 200% текста', async ({ page }) => {
  await page.goto(`${base}/admin/schedule`);
  await header(page);
  const records = [];
  for (const scale of [1, 2]) {
    const style = await page.addStyleTag({ content: `html { font-size: ${scale * 100}% }` });
    for (const width of scale === 1 ? widths : [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const record = await geometry(page);
      records.push({ scale, ...record });
      expect(record.overflow).toBeLessThanOrEqual(1);
      expect(record.links).toHaveLength(5);
      expect(record.links[0].x).toBeCloseTo(record.nav.x, 0);
      for (const link of record.links) {
        expect(link.radius).toBe('0px');
        expect(link.height).toBeGreaterThanOrEqual(44);
        expect(link.dx).toBeLessThanOrEqual(2);
        expect(link.dy).toBeLessThanOrEqual(2);
        const background = link.background === 'rgba(0, 0, 0, 0)' ? link.surface : link.background;
        expect(contrast(link.foreground, background)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(link.border, link.surface)).toBeGreaterThanOrEqual(3);
        const row = record.links.filter((other) => Math.abs(other.y - link.y) < 2);
        for (const other of row) {
          expect(Math.abs(other.height - link.height)).toBeLessThanOrEqual(2);
        }
      }
      if (scale === 1 && width >= 375 && width <= 1000) {
        const boxes = await page
          .locator('.header .brand, .header-logout-button, .mobile-menu-toggle')
          .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().toJSON()));
        const centers = boxes.map((box) => box.y + box.height / 2);
        expect(Math.max(...centers) - Math.min(...centers)).toBeLessThanOrEqual(2);
        expect((await page.locator('.header').boundingBox())!.height).toBeLessThanOrEqual(104);
      }
      await page.screenshot({
        path: `${output}/${test.info().project.name}-${width}-${scale}x.png`,
      });
    }
    await style.evaluate((element) => {
      element.parentNode?.removeChild(element);
    });
  }
  const nav = page.locator('.workspace-navigation');
  const before = await geometry(page);
  await nav.getByRole('link', { name: 'Заявки', exact: true }).hover();
  await nav.getByRole('link', { name: 'Заявки', exact: true }).focus();
  const after = await geometry(page);
  expect(contrast(after.links[1].outline, after.links[1].surface)).toBeGreaterThanOrEqual(3);
  expect(after.links.map(({ x, y, width, height }) => ({ x, y, width, height }))).toEqual(
    before.links.map(({ x, y, width, height }) => ({ x, y, width, height })),
  );
  writeFileSync(`${output}/${test.info().project.name}-geometry.json`, JSON.stringify(records));
});

test('действие шапки следует маршруту, ссылки сохраняют адреса и активное состояние', async ({
  page,
}) => {
  await page.goto(`${base}/`);
  await page.getByLabel('Кабинет администратора').click();
  for (let i = 0; i < paths.length; i++) {
    if (i > 0) await page.locator('.workspace-navigation a').nth(i).click();
    await expect(page).toHaveURL(base + paths[i]);
    await header(page);
    await expect(page.locator('.header a[href$="/admin/schedule"]')).toHaveCount(0);
    await expect(page.locator('.workspace-navigation button')).toHaveCount(0);
    await expect(page.locator('.workspace-navigation [aria-current="page"]')).toHaveCount(1);
    await expect(page.locator('.workspace-navigation [aria-current="page"]')).toHaveAttribute(
      'href',
      `/lastochka${paths[i]}`,
    );
    await page.reload();
    await header(page);
  }
  await page.locator('.header .brand').click();
  await expect(page.locator('.header').getByRole('button', { name: 'Выйти' })).toHaveCount(0);
  await expect(page.getByLabel('Кабинет администратора')).toBeVisible();
  await page.goto(`${base}/enquiry?next=/admin/schedule#admin`);
  await expect(page.getByLabel('Кабинет администратора')).toBeVisible();
  await expect(page.locator('.header').getByRole('button', { name: 'Выйти' })).toHaveCount(0);
});

test('ожидание и ошибки выхода не сдвигают шапку, повтор отзывает сессию', async ({
  page,
  context,
}) => {
  await page.goto(`${base}/admin/schedule`);
  const button = await header(page);
  const boxes = () =>
    page
      .locator('.header .brand, .header-logout-button, .mobile-menu-toggle')
      .evaluateAll((items) => items.map((item) => item.getBoundingClientRect().toJSON()));
  await page.route('**/api/v1/auth/csrf', (route) =>
    route.fulfill({ status: 403, json: { code: 'ACCESS_DENIED' } }),
  );
  let posts = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/auth/logout')) posts++;
  });
  await button.click();
  await expect(page.locator('.header-logout [role="alert"]')).toBeVisible();
  expect(posts).toBe(0);
  expect((await (await context.request.get(`${base}/api/v1/auth/me`)).json()).state).toBe('FULL');
  await page.unroute('**/api/v1/auth/csrf');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/api/v1/auth/logout', async (route) => {
    await gate;
    await route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE' } });
  });
  const before = await boxes();
  await button.click();
  const busy = page.locator('.header').getByRole('button', { name: 'Выходим…', exact: true });
  await expect(busy).toBeDisabled();
  await busy.dispatchEvent('click');
  expect(await boxes()).toEqual(before);
  release();
  await expect(page.locator('.header-logout [role="alert"]')).toContainText('недоступен');
  expect(await boxes()).toEqual(before);
  expect(posts).toBe(1);
  const alert = page.locator('.header-logout [role="alert"]');
  expect(
    await alert.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.x >= 0 && box.right <= innerWidth && box.y >= 0 && box.bottom <= innerHeight;
    }),
  ).toBeTruthy();
  await page.screenshot({ path: `${output}/${test.info().project.name}-logout-error.png` });
  await page.unroute('**/api/v1/auth/logout');
  await (await header(page)).click();
  await expect(page).toHaveURL(base + '/');
  expect((await (await context.request.get(`${base}/api/v1/auth/me`)).json()).state).toBe(
    'ANONYMOUS',
  );
});

test('ошибка проверки сессии не показывает подтверждённый выход', async ({ page }) => {
  await page.goto(`${base}/admin/schedule`);
  await header(page);
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ status: 503, json: { code: 'SERVICE_UNAVAILABLE' } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('link', { name: 'Повторить проверку входа' })).toBeVisible();
  await expect(page.locator('.header').getByRole('button', { name: 'Выйти' })).toHaveCount(0);
  await page.unroute('**/api/v1/auth/me');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await header(page);
});

test('публичное меню сохраняет пять якорных переходов из кабинета', async ({ page }) => {
  await page.goto(`${base}/admin/requests`);
  await header(page);
  const mobile = page.viewportSize()!.width <= 1000;
  for (const [label, id] of [
    ['О занятиях', 'approach'],
    ['Форматы', 'formats'],
    ['Тренер', 'coach'],
    ['Контакты', 'contacts'],
    ['Расписание', 'schedule'],
  ]) {
    const nav = page.locator(mobile ? '[data-mobile-menu-panel]' : '.desktop-navigation');
    if (mobile) await page.getByRole('button', { name: 'Меню', exact: true }).click();
    const link = nav.getByRole('link', { name: label, exact: true });
    await link.focus();
    await link.press('Enter');
    await expect(page).toHaveURL(`${base}/#${id}`);
    await expect(page.locator(`#${id}`)).toBeVisible();
    if (mobile) await expect(nav).toBeHidden();
    await expect(page.getByLabel('Кабинет администратора')).toBeVisible();
    await expect(page.locator('.header').getByRole('button', { name: 'Выйти' })).toHaveCount(0);
  }
});
