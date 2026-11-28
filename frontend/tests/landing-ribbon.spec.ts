import { expect, test, type Page } from '@playwright/test';

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
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const jump = (page: Page, y: number) =>
  page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), y);
const bottom = (page: Page) =>
  page.evaluate(() =>
    scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
  );

for (const width of [320, 390, 768, 1024, 1440, 1920])
  test(`отметки шагов и ширина страницы: ${width}`, async ({ page }) => {
    await open(page, width);
    await expect(page.locator('main canvas')).toHaveCount(0);
    const numbers = page.locator('.approach .number');
    await expect(numbers).toHaveText(['01', '02', '03']);
    const bridge = page.locator('#approach .step-line').last();
    await expect(bridge).toHaveCount(1);
    await expect(bridge).toHaveAttribute('aria-hidden', 'true');
    await numbers
      .last()
      .evaluate((el) =>
        scrollBy({ top: el.getBoundingClientRect().top - innerHeight * 0.35, behavior: 'instant' }),
      );
    await expect(bridge).toBeVisible();
    await expect(bridge).toHaveCSS('pointer-events', 'none');
    expect(await overflow(page)).toBe(0);
  });

for (const content of ['long', 'hidden', 'moved'])
  for (const width of [390, 1440])
    test(`изменённое содержание ${content}: ${width}`, async ({ page }) => {
      await mode(`content=${content}`);
      await open(page, width);
      const numbers = page.locator('.approach .number');
      await expect(numbers).toHaveCount(content === 'hidden' ? 0 : 3);
      await bottom(page);
      await expect(page.locator('[data-reveal="waiting"]')).toHaveCount(0);
      await expect(page.locator('.approach article[data-lit="true"] .number')).toHaveCount(
        content === 'hidden' ? 0 : 3,
      );
      expect(await overflow(page)).toBe(0);
    });

for (const width of [375, 1440]) {
  test(`номера включаются и гаснут по порядку: ${width}`, async ({ page }) => {
    await open(page, width, 900, './#approach');
    const numbers = page.locator('.approach .number');
    const lit = page.locator('.approach article[data-lit="true"] .number');
    const positions = await numbers.evaluateAll((all) =>
      all.map((el, i) => {
        const r = el.getBoundingClientRect();
        const row = all[0].getBoundingClientRect().top === all[1].getBoundingClientRect().top;
        return scrollY + r.top + r.height / 2 - innerHeight * (row ? 0.74 - 0.15 * i : 0.74);
      }),
    );
    for (const count of [0, 1, 2, 3, 2, 1, 0]) {
      await jump(page, count ? positions[count - 1] : positions[0] - 160);
      await expect(lit).toHaveText(['01', '02', '03'].slice(0, count));
      if (count) {
        await expect(numbers.nth(count - 1)).toBeInViewport();
        await expect(numbers.nth(count - 1).locator('.number-value')).toHaveCSS(
          'color',
          'rgb(255, 255, 255)',
        );
      }
      if (count === 2) {
        await page.reload();
        await expect(lit).toHaveText(['01', '02']);
      }
    }
    await page.setViewportSize({ width: width === 375 ? 1440 : 375, height: 900 });
    await numbers
      .last()
      .evaluate((el) =>
        scrollBy({ top: el.getBoundingClientRect().top - innerHeight * 0.35, behavior: 'instant' }),
      );
    await expect(lit).toHaveCount(3, { timeout: 5000 });
  });
}

for (const width of [375, 1440]) {
  test(`линия доходит до края каждого номера при включении: ${width}`, async ({ page }) => {
    await open(page, width, 900, './#approach');
    const row = width === 1440;
    const numbers = page.locator('#approach .number');
    const stops = await numbers.evaluateAll(
      (els, row) =>
        els.map((el, i) => {
          const r = el.getBoundingClientRect();
          return Math.ceil(
            scrollY + r.top + r.height / 2 - innerHeight * (row ? 0.8 - 0.15 * i : 0.8),
          );
        }),
      row,
    );
    async function read(index: number, y: number) {
      await jump(page, y);
      await page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
      return numbers.nth(index).evaluate((el, row) => {
        const r = el.getBoundingClientRect();
        const line = el.querySelector('.step-line')!.getBoundingClientRect();
        return {
          lit: el.parentElement!.dataset.lit,
          gap: row ? r.left - line.right : r.top - line.bottom,
          width: row ? line.height : line.width,
        };
      }, row);
    }
    for (const i of [1, 2]) {
      const mid = (stops[i - 1] + stops[i]) / 2;
      const midway = await read(i, mid);
      expect(midway.width).toBe(8);
      expect(midway.gap).toBeGreaterThan(8);
      expect(midway.lit).toBe('false');
      const before = await read(i, stops[i] - 2);
      expect(before.gap).toBeGreaterThan(0);
      expect(before.lit).toBe('false');
      const arrival = await read(i, stops[i] + 1);
      expect(Math.abs(arrival.gap)).toBeLessThan(1);
      expect(arrival.lit).toBe('true');
      const reverse = await read(i, mid);
      expect(reverse.lit).toBe('false');
      expect(Math.abs(reverse.gap - midway.gap)).toBeLessThan(2);
    }
  });
}

test('портрет доступен до прокрутки и с первого видимого края', async ({ page }) => {
  await open(page);
  const portrait = page.locator('.landing-coach-photo img');
  await expect(portrait).toHaveAttribute('loading', 'eager');
  await portrait.evaluate(async (img) => {
    await (img as HTMLImageElement).decode();
  });
  await expect(portrait).not.toBeInViewport();
  await expect(portrait).toHaveCSS('clip-path', 'none');
  await portrait.evaluate((el) =>
    scrollBy({ top: el.getBoundingClientRect().top - innerHeight + 8, behavior: 'instant' }),
  );
  await expect(portrait).toBeInViewport();
  await expect(portrait).toHaveCSS('clip-path', 'none');
  await expect(portrait).toHaveCSS('opacity', '1');
  await page.goto('./#coach');
  await expect(portrait).toBeInViewport();
  await expect(portrait).toHaveCSS('clip-path', 'none');
});

test('цитата реагирует на прокрутку, из контактов можно записаться', async ({ page }) => {
  await open(page);
  const dim = page.locator('.landing-coach-note > span[data-dim="true"]');
  await expect(dim.first()).toBeAttached();
  await bottom(page);
  await expect(dim).toHaveCount(0);
  await jump(page, 0);
  await expect(dim.first()).toBeAttached();
  await page.locator('#contacts .button').click();
  await expect(page).toHaveURL(/enquiry/);
});

test('уменьшенное движение: сразу и при смене настройки', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page);
  await expect(page.locator('main')).toHaveAttribute('data-enhanced', 'false');
  await expect(page.locator('.step-line').first()).toBeHidden();
  const badge = page.locator('.approach .number-orb').first();
  await expect(badge).toHaveCSS('transform', 'none');
  for (const el of await page.locator('.landing-formats-list img, .landing-coach-photo img').all())
    expect(await el.evaluate((e) => getComputedStyle(e).clipPath)).toBe('none');
  await jump(page, 1500);
  await expect(badge).toHaveCSS('transform', 'none');
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
  await expect(page.locator('.step-line').first()).toBeHidden();
  await expect(page.locator('.landing-coach-photo img')).toHaveCSS('clip-path', 'none');
  await expect(page.locator('.ages-figure:visible')).toHaveCount(5);
  await expect(page.locator('.approach .number:visible')).toHaveText(['01', '02', '03']);
  await expect(page.locator('.approach .number-orb').last()).toHaveCSS('transform', 'none');
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

test('светлые фоны разделов', async ({ page }) => {
  await open(page);
  for (const selector of [
    '.landing-hero',
    '.landing-approach',
    '.landing-formats',
    '.landing-coach',
  ])
    await expect(page.locator(selector)).toHaveCSS('background-color', 'rgb(247, 251, 250)');
  for (const selector of ['.landing-prices', '.landing-contacts', '.landing-ages'])
    await expect(page.locator(selector)).toHaveCSS('background-color', 'rgb(255, 255, 255)');
});

test('контраст текста на телефоне не ниже 4,5:1', async ({ page }) => {
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
  for (const base of [
    [255, 255, 255],
    [247, 251, 250],
  ]) {
    for (const ink of inks) {
      const rgb = ink
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number);
      expect((lum(base) + 0.05) / (lum(rgb) + 0.05), ink).toBeGreaterThanOrEqual(4.5);
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
  await agree.click();
  await expect.poll(started).toBeGreaterThan(0);
  await page.waitForTimeout(2500);
  await page.reload();
  await expect(agree).toHaveCount(0);
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
