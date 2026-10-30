import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base } from './support/actors';
test.use({ trace: 'off' });
const output = resolve(process.env.TEST_ARTIFACT_DIR ?? '../artifacts/landing-refinement');
mkdirSync(output, { recursive: true });
async function warm(page: import('@playwright/test').Page) {
  await page.goto(base + '/');
  for (const img of await page.locator('img').all()) {
    await img.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        img.evaluate((el) => el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0),
      )
      .toBe(true);
  }
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => scrollTo(0, 0));
  await expect(page.locator('main')).toHaveAttribute('data-enhanced', 'true');
}
test('hero and format scenes have visible intermediate states and reversible progress', async ({
  browser,
}) => {
  test.setTimeout(90000);
  for (const width of [375, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await warm(page);
    const report: unknown[] = [];
    for (const id of ['hero', 'formats']) {
      const states: number[] = [];
      for (const p of [0, 0.25, 0.5, 0.75, 1, 0.5]) {
        const y = await page.locator('#' + id).evaluate((el, p) => {
          const r = el.getBoundingClientRect();
          const top = r.top + scrollY;
          const start =
            el.id === 'hero' ? Math.max(0, top - innerHeight * 0.2) : top - innerHeight * 0.75;
          const length =
            el.id === 'hero'
              ? Math.max(240, Math.min(r.height * 0.75, innerHeight * 0.9))
              : Math.max(240, r.height);
          return start + length * p;
        }, p);
        await page.evaluate((y) => scrollTo(0, y), y);
        await expect
          .poll(() =>
            page
              .locator('#' + id)
              .evaluate((el) => parseFloat(el.style.getPropertyValue('--progress'))),
          )
          .toBeCloseTo(p, 2);
        states.push(
          await page
            .locator('#' + id)
            .evaluate((el) => parseFloat(el.style.getPropertyValue('--progress'))),
        );
        if (states.length <= 5)
          await page.screenshot({ path: resolve(output, `${id}-${width}-${p * 100}.png`) });
      }
      expect(states[5]).toBeCloseTo(states[2], 2);
      report.push({ id, states });
    }
    writeFileSync(resolve(output, `states-${width}.json`), JSON.stringify(report, null, 2));
    await page.goto(base + '/#contacts');
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Пусть движение станет радостью.' }),
    ).toBeInViewport();
    await context.close();
  }
});
test('media hover and keyboard focus react without shifting cards', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await warm(page);
  const image = page.locator('.hero-media img');
  await page.locator('.hero-visual').hover();
  await expect
    .poll(() => image.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a))
    .toBeGreaterThan(1.02);
  await page.screenshot({ path: resolve(output, 'hero-hover.png') });
  await page.mouse.move(0, 0);
  await expect
    .poll(() => image.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a))
    .toBeLessThan(1.001);
  const card = page.locator('.format-card').first();
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const before = await card.boundingBox();
  await card.hover();
  await expect(card).toHaveCSS('border-color', 'rgb(123, 184, 181)');
  await expect(card.locator('img')).toHaveCSS('transform', 'none');
  const after = await card.boundingBox();
  expect(after?.width).toBeCloseTo(before!.width, 1);
  expect(after?.y).toBeCloseTo(before!.y, 1);
  await page.screenshot({ path: resolve(output, 'formats-hover.png') });
  await page.mouse.move(0, 0);
  await card.getByRole('link', { name: 'Выбрать занятие' }).focus();
  await expect(card).toHaveCSS('border-color', 'rgb(16, 102, 106)');
  await expect(page.locator('.hero-visual')).not.toHaveAttribute('tabindex');
});
test('coach keeps its whole source composition at all responsive widths', async ({ page }) => {
  test.setTimeout(90000);
  const report: unknown[] = [];
  for (const width of [375, 390, 1280, 1440, 1728, 1920])
    for (const height of [700, 1000]) {
      await page.setViewportSize({ width, height });
      await page.goto(base + '/#coach');
      const img = page.locator('#coach img');
      await img.scrollIntoViewIfNeeded();
      await expect
        .poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
      const result = await img.evaluate((el) => {
        const img = el as HTMLImageElement,
          r = img.getBoundingClientRect(),
          frame = img.closest('figure')!.getBoundingClientRect();
        return {
          width: r.width,
          height: r.height,
          ratio: img.naturalWidth / img.naturalHeight,
          fit: getComputedStyle(img).objectFit,
          headroom: r.top - frame.top,
        };
      });
      expect(result.fit).toBe('contain');
      expect(result.width / result.height).toBeCloseTo(result.ratio, 3);
      expect(result.headroom).toBeGreaterThanOrEqual(12);
      await img.hover();
      expect(await img.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
      await page
        .locator('#coach')
        .evaluate((el) => scrollTo(0, el.getBoundingClientRect().top + scrollY - 20));
      await page.screenshot({ path: resolve(output, `coach-${width}-${height}.png`) });
      report.push({ viewport: { width, height }, ...result });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  writeFileSync(resolve(output, 'coach-composition.json'), JSON.stringify(report, null, 2));
});

test.describe('production motion budget', () => {
  test('continuous wheel scroll meets frame budget with real video and CPU trace', async ({
    browser,
  }) => {
    test.setTimeout(120000);
    for (const width of [375, 1440]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        recordVideo: { dir: output, size: { width: Math.min(width, 720), height: 900 } },
      });
      const page = await context.newPage();
      await warm(page);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await cdp.send('Tracing.start', {
        categories: 'devtools.timeline,blink.user_timing',
        transferMode: 'ReturnAsStream',
      });
      await page.evaluate(() => {
        const frames: number[] = [],
          tasks: number[] = [];
        let last = 0,
          id = 0;
        const observer = new PerformanceObserver((list) =>
          tasks.push(...list.getEntries().map((e) => e.duration)),
        );
        observer.observe({ type: 'longtask', buffered: false });
        function frame(at: number) {
          if (last) frames.push(at - last);
          last = at;
          id = requestAnimationFrame(frame);
        }
        id = requestAnimationFrame(frame);
        (
          window as unknown as { stopMotionSample: () => { frames: number[]; tasks: number[] } }
        ).stopMotionSample = () => {
          cancelAnimationFrame(id);
          tasks.push(...observer.takeRecords().map((e) => e.duration));
          observer.disconnect();
          return { frames, tasks };
        };
      });
      const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      const steps = Math.ceil(max / 110) + 2;
      for (const direction of [1, -1])
        for (let i = 0; i < steps; i++) {
          await page.mouse.wheel(0, direction * 110);
          await page.waitForTimeout(16);
        }
      const sample = await page.evaluate(() =>
        (
          window as unknown as { stopMotionSample: () => { frames: number[]; tasks: number[] } }
        ).stopMotionSample(),
      );
      const sorted = sample.frames.toSorted((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      const over50 = sorted.filter((n) => n > 50).length / sorted.length;
      const report = {
        width,
        height: 900,
        cpuSlowdown: 4,
        browser: browser.version(),
        p95,
        over50,
        frames: sorted.length,
        longTasks: sample.tasks,
      };
      writeFileSync(
        resolve(output, `motion-budget-${width}.json`),
        JSON.stringify(report, null, 2),
      );
      const complete = new Promise<{ stream?: string }>((done) =>
        cdp.once('Tracing.tracingComplete', done),
      );
      await cdp.send('Tracing.end');
      const { stream } = await complete;
      if (!stream) throw Error('No trace stream');
      let data = '';
      for (;;) {
        const part = await cdp.send('IO.read', { handle: stream });
        data += part.data;
        if (part.eof) break;
      }
      await cdp.send('IO.close', { handle: stream });
      writeFileSync(resolve(output, `motion-trace-${width}.json`), data);
      const video = page.video();
      await context.close();
      await video?.saveAs(resolve(output, `scroll-${width}.webm`));
      expect(p95).toBeLessThanOrEqual(32);
      expect(over50).toBeLessThanOrEqual(0.01);
      expect(sample.tasks.filter((t) => t > 100)).toEqual([]);
    }
  });
});

test('touch opens a guest enquiry on the first tap without hover', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  for (const selector of ['.format-card a', '#contacts a.button']) {
    await page.goto(base + '/');
    await page.locator(selector).first().tap();
    await expect(page.getByRole('heading', { name: 'Заявка на занятие' })).toBeVisible();
    await expect(page).toHaveURL(/\/enquiry$/);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});
