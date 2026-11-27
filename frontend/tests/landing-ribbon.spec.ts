import { expect, test, type Page } from '@playwright/test';
import {
  buildRoute,
  collectBoxes,
  lengthAt,
  ribbonAlpha,
  ribbonColors,
  ribbonWidth,
} from '../app/ui/landing-route';

const mode = (query = '') => fetch(`http://127.0.0.1:48894/__fixture/mode?${query}`);
const errors: string[] = [];
test.beforeEach(async ({ page }) => {
  await mode();
  errors.length = 0;
  // The production server has no API proxy; send browser requests straight to the fixture.
  await page.route('**/api/v1/**', async (route) =>
    route.fulfill({
      response: await route.fetch({
        url: 'http://127.0.0.1:48894' + new URL(route.request().url()).pathname,
      }),
    }),
  );
  page.on('pageerror', (e) => errors.push(e.message));
  page.on(
    'console',
    (m) =>
      m.type() === 'error' &&
      !m.text().startsWith('Failed to load resource') &&
      errors.push(m.text()),
  );
});
test.afterEach(() => expect(errors).toEqual([]));

async function open(page: Page, width = 1440, height = 900, path = './') {
  await page.setViewportSize({ width, height });
  await page.goto(path);
  await expect(page.locator('main')).toHaveAttribute('data-enhanced', /true|false/);
  await expect(
    page.locator('.poster-panel, .poster-day-empty, .notice.error').first(),
  ).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
}
const boxes = (page: Page) => page.locator('main').evaluate(collectBoxes);
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const painted = (page: Page) =>
  page.locator('.landing-ribbon').evaluate((c: HTMLCanvasElement) => {
    const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) n++;
    return n;
  });
const jump = (page: Page, y: number) =>
  page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), y);
const bottom = (page: Page) =>
  page.evaluate(() =>
    scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
  );

for (const width of [320, 390, 768, 1024, 1440, 1920])
  test(`маршрут не задевает текст: ${width}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, width);
    const input = await boxes(page);
    const route = buildRoute(input)!;
    expect(route.markers).toHaveLength(3);
    const gap = (x: number, y: number, b: (typeof input.text)[0]) =>
      Math.hypot(Math.max(b.l - x, 0, x - b.r), Math.max(b.t - y, 0, y - b.b));
    const full = ribbonWidth(route.mobile) / 2;
    let hiddenRibbon = 0;
    let hiddenBird = 0;
    for (const p of route.points) {
      const near = Math.min(...input.text.map((b) => gap(p.x, p.y, b)));
      if (p.bird > 0) expect(near).toBeGreaterThan(route.mobile ? 18 : 30);
      if (!route.mobile && p.ribbon > 0) expect(near).toBeGreaterThan(full);
      if (!p.ribbon) hiddenRibbon++;
      if (!p.bird) hiddenBird++;
    }
    console.log(
      width,
      'лента скрыта',
      (hiddenRibbon / route.points.length).toFixed(3),
      'ласточка',
      (hiddenBird / route.points.length).toFixed(3),
    );
    if (!route.mobile) expect(hiddenRibbon / route.points.length).toBeLessThan(0.12);
    for (let i = 1; i < route.stops.length; i++) {
      expect(route.stops[i][0]).toBeGreaterThanOrEqual(route.stops[i - 1][0]);
      expect(route.stops[i][1]).toBeGreaterThan(route.stops[i - 1][1]);
    }
    // A marker lights while it is still in the upper-middle part of the screen at the latest.
    const marks = input.sections.find((x) => x.kind === 'approach')!.list;
    marks.forEach((m, i) =>
      expect(lengthAt(route, (m.t + m.b) / 2 - input.viewport * 0.4)).toBeGreaterThan(
        route.markers[i],
      ),
    );
    expect(lengthAt(route, input.height - input.viewport)).toBe(route.total);
    expect(await overflow(page)).toBe(0);
  });

for (const content of ['long', 'hidden', 'moved'])
  for (const width of [390, 1440])
    test(`изменённое содержание ${content}: ${width}`, async ({ page }) => {
      await mode(`content=${content}`);
      await open(page, width);
      const input = await boxes(page);
      const route = buildRoute(input)!;
      expect(route.points.every((p) => Number.isFinite(p.x + p.y))).toBe(true);
      expect(lengthAt(route, input.height - input.viewport)).toBe(route.total);
      await bottom(page);
      await expect(page.locator('[data-reveal="waiting"]')).toHaveCount(0);
      expect(await overflow(page)).toBe(0);
    });

test('лента растёт, сматывается и засыпает', async ({ page }) => {
  await open(page);
  await page.waitForTimeout(3000);
  const lit = page.locator('.approach article[data-lit="true"]');
  await expect(lit).toHaveCount(0);
  const y = await page
    .locator('#approach')
    .evaluate((e) => e.getBoundingClientRect().bottom + scrollY);
  await jump(page, y - 300);
  await expect(lit).toHaveCount(3);
  expect(await painted(page)).toBeGreaterThan(1000);
  await jump(page, 0);
  await expect(lit).toHaveCount(0);
  await page.evaluate(() => {
    const w = window as unknown as { draws: number };
    w.draws = 0;
    const original = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...a) {
      w.draws++;
      return original.apply(this, a);
    };
  });
  await page.waitForTimeout(7000);
  const before = await page.evaluate(() => (window as unknown as { draws: number }).draws);
  expect(before).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as unknown as { draws: number }).draws)).toBe(before);
});

test('лента доходит до кнопки записи и не принимает нажатия', async ({ page }) => {
  await open(page);
  await bottom(page);
  await page.waitForTimeout(2500);
  const button = page.locator('#contacts .button');
  const r = (await button.boundingBox())!;
  const ink = await page.locator('.landing-ribbon').evaluate((c: HTMLCanvasElement, b) => {
    const at = c.getBoundingClientRect();
    const k = c.width / at.width;
    const { data } = c
      .getContext('2d')!
      .getImageData((b.x + b.width - at.left) * k, (b.y - 60 - at.top) * k, 100 * k, 120 * k);
    return data.some((v, i) => i % 4 === 3 && v > 0);
  }, r);
  expect(ink).toBe(true);
  await expect(page.locator('.landing-ribbon')).toHaveAttribute('aria-hidden', 'true');
  await button.click();
  await expect(page).toHaveURL(/enquiry/);
});

test('уменьшенное движение: сразу и при смене настройки', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await expect(page.locator('main')).toHaveAttribute('data-enhanced', 'false');
  expect(await painted(page)).toBeGreaterThan(1000);
  for (const el of await page.locator('.landing-formats-list img, .landing-coach-photo img').all())
    expect(await el.evaluate((e) => getComputedStyle(e).clipPath)).toBe('none');
  await jump(page, 1500);
  await expect
    .poll(() => page.locator('.landing-ribbon').evaluate((e) => parseFloat(e.style.top)))
    .toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('main')).toHaveAttribute('data-enhanced', 'true');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('main')).toHaveAttribute('data-enhanced', 'false');
});

test('без JavaScript всё видно', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:48893/');
  await expect(
    page.getByRole('heading', { name: 'Двигаться легко. Расти уверенно.' }),
  ).toBeVisible();
  await expect(
    page.getByText('Внимательное знакомство с движением начинается с доверия.'),
  ).toBeVisible();
  await expect(page.locator('[data-reveal]')).toHaveCount(0);
  await expect(page.locator('.ages-figure:visible')).toHaveCount(5);
  await context.close();
});

test('раскрытие один раз, якорь, перезагрузка и фокус', async ({ page }) => {
  await open(page);
  const formats = page.locator('.landing-formats-list article');
  await expect(formats.first()).toHaveAttribute('data-reveal', 'waiting');
  await formats.first().scrollIntoViewIfNeeded();
  await formats.first().evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await expect(formats.first()).toHaveAttribute('data-reveal', 'shown');
  await jump(page, 0);
  await expect(formats.first()).toHaveAttribute('data-reveal', 'shown');
  await page.goto('./#coach');
  await expect(page.locator('#coach h2')).toBeInViewport();
  await page.reload();
  await expect(page.locator('#coach h2')).toBeInViewport();
  await expect(page.locator('#formats [data-reveal="waiting"]')).toHaveCount(0);
  await open(page);
  await page.locator('.landing-formats-list a').last().focus();
  await expect(formats.last()).toHaveAttribute('data-reveal', 'shown');
  await page.waitForTimeout(1600);
  expect(
    await formats
      .last()
      .locator('img')
      .evaluate((e) => getComputedStyle(e).clipPath),
  ).toMatch(/^inset\(0(px|%)?\)$/);
});

for (const count of [1, 5, 7, 8])
  for (const width of [320, 1440])
    test(`фигур ${count} на ширине ${width}`, async ({ page }) => {
      await mode(`count=${count}`);
      await open(page, width);
      await expect(page.locator('.ages-figure')).toHaveCount(count === 8 ? 5 : count);
      await expect(page.locator('.ages-label')).toHaveCount(count === 8 ? 0 : count);
      await page.locator('.ages-art').scrollIntoViewIfNeeded();
      await page.waitForTimeout(2500);
      const apart = await page.locator('.ages-figure svg').evaluateAll((all) =>
        all.every((svg, i) => {
          const ink = (e: Element) => {
            const r = [...e.querySelectorAll('path,circle')].map((p) => p.getBoundingClientRect());
            return [Math.min(...r.map((x) => x.left)), Math.max(...r.map((x) => x.right))];
          };
          return i === 0 || ink(svg)[0] >= ink(all[i - 1])[1] - 1;
        }),
      );
      expect(apart).toBe(true);
      const copy = (await page.locator('#age-groups .landing-section-intro').boundingBox())!;
      const art = (await page.locator('.ages-art').boundingBox())!;
      expect(art.x >= copy.x + copy.width - 1 || art.y >= copy.y + copy.height - 1).toBe(true);
      expect(await overflow(page)).toBe(0);
    });

test('расписание: волна, медленная загрузка, пусто и сбой', async ({ page }) => {
  await open(page);
  const panel = page.locator('.poster-panel');
  await expect(panel).toHaveAttribute('data-reveal', 'waiting');
  await panel.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await expect(panel).toHaveAttribute('data-reveal', 'shown');
  await page.waitForTimeout(1800);
  const times = page.locator('.poster-wide .poster-time');
  await expect(times).toHaveCount(14);
  expect(await times.last().evaluate((e) => getComputedStyle(e).opacity)).toBe('1');
  await times.first().click();
  await expect(page).toHaveURL(/weekly=/);
  await mode('schedule=slow');
  await page.goto('./', { waitUntil: 'commit' });
  await expect(page.locator('.ages-figure')).toHaveCount(5);
  await expect(page.locator('.ages-label')).toHaveCount(5);
  await mode('schedule=empty');
  await open(page);
  await expect(page.getByText('Набираем группы')).toBeAttached();
  await mode('schedule=error');
  await open(page);
  await expect(page.locator('.ages-figure')).toHaveCount(5);
  await expect(page.locator('.ages-label')).toHaveCount(0);
  await mode();
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(panel).toBeVisible();
  await expect(page.locator('.poster-time').first()).toBeVisible();
});

test('короткий экран и крупный текст', async ({ page }) => {
  await open(page, 667, 375);
  await page.addStyleTag({ content: 'html{font-size:200%}' });
  await bottom(page);
  await expect(page.locator('[data-reveal="waiting"]')).toHaveCount(0);
  expect(await overflow(page)).toBe(0);
  await expect(page.locator('#contacts .button')).toBeVisible();
});

test('вступление не задерживает действие', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./', { waitUntil: 'commit' });
  await page.locator('.landing-hero .button').click({ timeout: 2000 });
  await expect(page).toHaveURL(/enquiry/);
});

test('фоны разделов лежат под лентой, светлая палитра прежняя', async ({ page }) => {
  await open(page);
  const fills = await page
    .locator('main > section')
    .evaluateAll((all) =>
      all.map((e) => [
        getComputedStyle(e).backgroundColor,
        getComputedStyle(e, '::before').backgroundColor,
      ]),
    );
  for (const [own, under] of fills) {
    expect(own).toBe('rgba(0, 0, 0, 0)');
    expect(['rgba(0, 0, 0, 0)', 'rgb(255, 255, 255)', 'rgb(247, 251, 250)']).toContain(under);
  }
});

test('текст над лентой на телефоне не бледнее 4,5:1', async ({ page }) => {
  await open(page, 390, 844);
  const inks = await page
    .locator('main')
    .evaluate((main) => [
      ...new Set(
        [...main.querySelectorAll('p,a,h1,h2,h3,h4,strong,summary,span')]
          .filter((e) => !e.closest('.button,.number,.poster-day,.poster-card,[data-dim="true"]'))
          .map((e) => getComputedStyle(e).color),
      ),
    ]);
  const lum = (c: number[]) =>
    c
      .map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const alpha = ribbonAlpha(true, 0);
  for (const hex of ribbonColors)
    for (const base of [
      [255, 255, 255],
      [247, 251, 250],
    ]) {
      const under = base.map(
        (v, i) => v * (1 - alpha) + parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) * alpha,
      );
      for (const ink of inks) {
        const rgb = ink
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
        const pair = [lum(under), lum(rgb)].sort((a, b) => b - a);
        expect((pair[0] + 0.05) / (pair[1] + 0.05), `${ink} ${hex}`).toBeGreaterThanOrEqual(4.5);
      }
    }
});

test('вступление начинается после окна согласия и не повторяется потом', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'webdriver', { get: () => false }),
  );
  const started = () =>
    page.evaluate(
      () =>
        document
          .getAnimations()
          .filter((a) => /landing-(word|photo)-in/.test((a as CSSAnimation).animationName)).length,
    );
  await open(page);
  const agree = page.getByRole('button', { name: 'Согласен' });
  await expect(agree).toBeVisible();
  await page.waitForTimeout(2500);
  expect(await started()).toBe(0);
  expect(await painted(page)).toBe(0);
  await agree.click();
  await expect.poll(started).toBeGreaterThan(0);
  await expect.poll(() => painted(page)).toBeGreaterThan(1000);
  await page.waitForTimeout(2500);
  await page.reload();
  await expect(agree).toHaveCount(0);
  await expect.poll(() => painted(page)).toBeGreaterThan(1000);
});

for (const width of [375, 1440]) {
  test(`обновление сохраняет место чтения с якорем: ${width}`, async ({ page }) => {
    await open(page, width, width === 375 ? 812 : 900, './#approach');
    const heading = page.locator('#approach h2');
    const headingTop = () => heading.evaluate((element) => element.getBoundingClientRect().top);
    const targetY = await page.evaluate(() => scrollY);
    for (const position of [targetY - 160, targetY + 140, 0]) {
      await jump(page, Math.max(0, position));
      await page.waitForTimeout(350); // Let the compact header finish changing size.
      const before = await headingTop();
      for (let reload = 0; reload < 2; reload++) {
        await page.reload();
        await expect(page.locator('main')).toHaveAttribute('data-enhanced', /true|false/);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(350);
        expect(Math.abs((await headingTop()) - before)).toBeLessThanOrEqual(2);
        if (position === 0) expect(await page.evaluate(() => scrollY)).toBe(0);
      }
    }
  });
}
