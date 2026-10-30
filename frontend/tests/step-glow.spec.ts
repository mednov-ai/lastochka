import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const output = resolve(
  process.env.TEST_ARTIFACT_DIR ?? new URL('../../artifacts/step-glow/', import.meta.url).pathname,
);
mkdirSync(output, { recursive: true });
async function settle(page: Page, y: number) {
  await page.evaluate(async (y) => {
    scrollTo(0, y);
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  }, y);
}
async function warm(page: Page) {
  await page.goto('');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((i) => {
        i.loading = 'eager';
        return i.decode().catch(() => {});
      }),
    );
  });
  await expect(page.locator('main')).toHaveAttribute('data-enhanced', 'true');
}
async function phases(page: Page) {
  return page
    .locator('#approach article')
    .evaluateAll((es) =>
      es.map((e) => Number((e as HTMLElement).style.getPropertyValue('--item-progress'))),
    );
}

test('each orb lights inside the viewport, stays readable and reverses without drift', async ({
  page,
}, info) => {
  await warm(page);
  await expect(page.locator('.illustration-label')).toHaveCount(0);
  await expect(page.getByText('Иллюстрация занятия', { exact: true })).toHaveCount(0);
  await expect(page.locator('#hero img')).toHaveAttribute('alt', /./);
  await page.screenshot({ path: resolve(output, `after-hero-${info.project.name}.png`) });
  const height = page.viewportSize()!.height;
  const anchors = await page.locator('#approach .number').evaluateAll((es) =>
    es.map((e) => {
      const r = e.getBoundingClientRect();
      return r.top + scrollY + r.height / 2;
    }),
  );
  const horizontal = Math.max(...anchors) - Math.min(...anchors) < 2;
  const rows = [];
  for (let i = 0; i < anchors.length; i++) {
    const base = anchors[i] - height * 0.85;
    await settle(page, base - 4);
    expect((await phases(page))[i]).toBe(0);
    const start = base + (horizontal ? i * height * 0.08 : 0);
    const samples = [];
    for (const phase of [0, 0.25, 0.5, 0.75, 1]) {
      const y = start + height * 0.14 * phase;
      await settle(page, y);
      const ps = await phases(page);
      expect(ps[i]).toBeCloseTo(phase, 1);
      expect(ps[0]).toBeGreaterThanOrEqual(ps[1]);
      expect(ps[1]).toBeGreaterThanOrEqual(ps[2]);
      const style = await page
        .locator('#approach .number')
        .nth(i)
        .evaluate((e) => {
          const orb = e.querySelector('.number-orb')!,
            value = e.querySelector('.number-value')!,
            r = e.getBoundingClientRect(),
            os = getComputedStyle(orb),
            vs = getComputedStyle(value);
          const rgb = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
          const lum = (s: string) =>
            rgb(s).reduce(
              (a, x, j) =>
                a +
                [0.2126, 0.7152, 0.0722][j] *
                  (x / 255 <= 0.04045 ? x / 255 / 12.92 : ((x / 255 + 0.055) / 1.055) ** 2.4),
              0,
            );
          const ratio = (a: string, b: string) => {
            const x = lum(a),
              y = lum(b);
            return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
          };
          return {
            y: r.top,
            bottom: r.bottom,
            scale: new DOMMatrix(os.transform).a,
            opacity: Number(getComputedStyle(orb, '::after').opacity),
            color: vs.color,
            textContrast: ratio(vs.color, getComputedStyle(e.closest('section')!).backgroundColor),
            borderContrast: ratio(
              os.borderColor,
              getComputedStyle(e.closest('section')!).backgroundColor,
            ),
            header: document.querySelector('.header')!.getBoundingClientRect().bottom,
            width: orb.getBoundingClientRect().width,
            height: orb.getBoundingClientRect().height,
            radius: parseFloat(os.borderTopLeftRadius),
            valueRadius: parseFloat(vs.borderTopLeftRadius),
            valueWidth: value.getBoundingClientRect().width,
            textTop: e.closest('article')!.querySelector('h3')!.getBoundingClientRect().top,
            orbBottom: orb.getBoundingClientRect().bottom,
          };
        });
      expect(style.color).toMatch(/^rgb\(/);
      expect(style.textContrast).toBeGreaterThanOrEqual(4.5);
      expect(style.width).toBeCloseTo(64, 1);
      expect(style.height).toBeCloseTo(64, 1);
      expect(style.scale).toBe(1);
      expect(style.radius).toBe(0);
      expect(style.orbBottom).toBeLessThan(style.textTop);
      expect(style.opacity).toBeCloseTo(phase, 1);
      expect(style.y).toBeGreaterThan(style.header);
      expect(style.bottom).toBeLessThan(height);
      samples.push({ phase, ps, style });
      if ([0, 0.5, 1].includes(phase))
        await page.screenshot({
          path: resolve(output, `orb-${i}-${phase}-${info.project.name}.png`),
        });
    }
    await settle(page, start + height * 0.07);
    const before = await phases(page);
    await page.waitForTimeout(150);
    expect(await phases(page)).toEqual(before);
    await page.reload();
    await expect(page.locator('main')).toHaveAttribute('data-enhanced', 'true');
    // WebKit starts reload at the top; emulate restoration to the saved offset.
    await settle(page, start + height * 0.07);
    await expect.poll(async () => Math.abs((await phases(page))[i] - 0.5)).toBeLessThan(0.03);
    rows.push({ i, anchor: anchors[i], samples });
  }
  writeFileSync(resolve(output, `phases-${info.project.name}.json`), JSON.stringify(rows, null, 2));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('main')).toHaveAttribute('data-enhanced', 'false');
  await expect.poll(() => phases(page)).toEqual([1, 1, 1]);
  await expect(page.locator('.number-orb').first()).toHaveCSS('transform', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('main')).toHaveAttribute('data-enhanced', 'true');
});

test('responsive geometry, text zoom and static touch preserve content and enquiry', async ({
  browser,
}, info) => {
  for (const size of [
    { width: 320, height: 568 },
    { width: 768, height: 600 },
    { width: 375, height: 600 },
  ]) {
    const c = await browser.newContext({
      viewport: size,
      hasTouch: true,
      locale: info.project.use.locale,
    });
    const p = await c.newPage();
    await warm(p);
    if (size.width === 375)
      await p.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
    await p.locator('#approach').evaluate((e) => {
      e.querySelector('h3')!.textContent += ' Поддержка и внимание к каждому ребёнку';
    });
    await p.waitForTimeout(100);
    for (let i = 0; i < 3; i++) {
      const y = await p
        .locator('.number')
        .nth(i)
        .evaluate((e) => {
          const r = e.getBoundingClientRect();
          return r.top + scrollY + r.height / 2 - innerHeight * 0.85;
        });
      await settle(p, y - 3);
      expect((await phases(p))[i]).toBe(0);
      await settle(p, y + size.height * 0.4);
      await expect.poll(async () => (await phases(p))[i]).toBeGreaterThan(0.95);
    }
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await p
      .locator('.header')
      .getByRole('link', { name: /Записаться/ })
      .tap();
    await expect(p.getByRole('heading', { name: 'Заявка на занятие' })).toBeVisible();
    await c.close();
  }
  const c = await browser.newContext({
      javaScriptEnabled: false,
      hasTouch: true,
      viewport: { width: 375, height: 844 },
    }),
    p = await c.newPage();
  await p.goto(process.env.TEST_APP_URL ?? 'http://localhost:5179/lastochka/');
  await expect(p.locator('.illustration-label')).toHaveCount(0);
  await expect(p.locator('.number-value')).toHaveText(['01', '02', '03']);
  await expect(p.locator('.number-orb').first()).toBeVisible();
  await p
    .locator('.header')
    .getByRole('link', { name: /Записаться/ })
    .tap();
  await expect(p).toHaveURL(/\/enquiry$/);
  await c.close();
});
