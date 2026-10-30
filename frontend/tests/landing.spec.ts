import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const app = (process.env.TEST_APP_URL ?? 'http://localhost:5173/lastochka').replace(/\/$/, '');

test('landing SSR, mobile layout, keyboard access and motion fallback', async ({ browser }) => {
  mkdirSync(resolve('../artifacts'), { recursive: true });
  for (const width of [375, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage();
    const response = await page.goto(app + '/');
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: 'Двигаться легко. Расти уверенно.' }),
    ).toBeVisible();
    for (const image of await page.locator('img').all()) {
      await image.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          image.evaluate((i) => i instanceof HTMLImageElement && i.complete && i.naturalWidth > 0),
        )
        .toBe(true);
    }
    await page.evaluate(() => scrollTo(0, 0));
    expect(
      await page.evaluate(() =>
        Array.from(document.querySelectorAll('body *'))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);
          })
          .map((el) => ({
            tag: el.tagName,
            cls: el.className,
            right: el.getBoundingClientRect().right,
            left: el.getBoundingClientRect().left,
          }))
          .slice(0, 12),
      ),
    ).toEqual([]);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'К содержимому' })).toBeFocused();
    await page.screenshot({ path: resolve(`../artifacts/lastochka-${width}.png`), fullPage: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('main')).toHaveAttribute('data-enhanced', 'false');
    expect(
      await page
        .locator('.format-card')
        .first()
        .evaluate((el) => getComputedStyle(el).transform),
    ).toBe('none');
    await page.getByRole('link', { name: 'Как проходят занятия' }).click();
    await expect(page).toHaveURL(/#approach$/);
    await context.close();
  }
  const nojs = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 375, height: 900 },
  });
  const page = await nojs.newPage();
  await page.goto(app + '/');
  await expect(page.getByRole('heading', { name: 'Родители спрашивают.' })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'Это медицинские занятия?' }).click();
  await expect(
    page.getByText('Нет. Это физкультурно-оздоровительные занятия, без диагностики и лечения.'),
  ).toBeVisible();
  expect(await page.locator('meta[name="description"]').getAttribute('content')).toContain(
    'детей 5–14 лет',
  );
  await nojs.close();
});

test('scroll scenes track intermediate positions and reverse consistently', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app + '/');
  await expect(page.locator('main')).toHaveAttribute('data-enhanced', 'true');
  const stroke = page.locator('#approach .thread-progress');
  const values: number[] = [];
  for (const progress of [0.25, 0.5, 0.75, 0.5]) {
    await page.locator('#approach').evaluate((el, p) => {
      const r = el.getBoundingClientRect();
      const anchor = el.querySelector('.number')!.getBoundingClientRect();
      scrollTo(
        0,
        anchor.top + scrollY + anchor.height / 2 - innerHeight * 0.85 + p * innerHeight * 0.3,
      );
    }, progress);
    await expect
      .poll(() =>
        page.locator('#approach').evaluate((el) => {
          const progress = Number((el as HTMLElement).style.getPropertyValue('--progress'));
          const stroke = Number.parseFloat(
            getComputedStyle(el.querySelector('.thread-progress')!).strokeDashoffset.replace(
              'calc(',
              '',
            ),
          );
          return Math.abs(stroke - (1 - progress));
        }),
      )
      .toBeLessThan(0.005);
    await page.waitForTimeout(50);
    values.push(
      parseFloat(
        (await stroke.evaluate((el) => getComputedStyle(el).strokeDashoffset)).replace('calc(', ''),
      ),
    );
  }
  expect(values[1]).toBeCloseTo(values[3], 2);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('main')).toHaveAttribute('data-enhanced', 'false');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('main')).toHaveAttribute('data-enhanced', 'true');
});

test('production scroll budget, reload mid-scene and listener cleanup', async ({ browser }) => {
  test.skip(
    process.env.TEST_PRODUCTION !== '1',
    'Performance budget is measured against production bundles',
  );
  test.setTimeout(90000);
  for (const width of [375, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(app + '/');
    await expect(page.locator('main')).toHaveAttribute('data-enhanced', 'true');
    await page.evaluate(() => document.fonts.ready);
    await cdp.send('Tracing.start', {
      categories: 'devtools.timeline,blink.user_timing',
      transferMode: 'ReturnAsStream',
    });
    const tasks = await page.evaluate(async () => {
      const durations: number[] = [];
      const observer = new PerformanceObserver((list) =>
        durations.push(...list.getEntries().map((e) => e.duration)),
      );
      observer.observe({ type: 'longtask', buffered: false });
      const step = () => new Promise<void>((done) => requestAnimationFrame(() => done()));
      const max = document.documentElement.scrollHeight - innerHeight;
      for (const direction of [1, -1])
        for (let i = 0; i <= 80; i++) {
          scrollTo(0, max * (direction === 1 ? i / 80 : 1 - i / 80));
          await step();
          await step();
        }
      await step();
      await step();
      observer.disconnect();
      return durations;
    });
    const traceComplete = new Promise<{ stream?: string }>((done) =>
      cdp.once('Tracing.tracingComplete', done),
    );
    await cdp.send('Tracing.end');
    const { stream } = await traceComplete;
    if (!stream) throw new Error('No trace stream');
    let trace = '';
    for (;;) {
      const part = await cdp.send('IO.read', { handle: stream });
      trace += part.data;
      if (part.eof) break;
    }
    await cdp.send('IO.close', { handle: stream });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(resolve(`../artifacts/scroll-trace-${width}.json`), trace);
    writeFileSync(
      resolve(`../artifacts/scroll-budget-${width}.json`),
      JSON.stringify(
        {
          width,
          height: 900,
          cpuSlowdown: 4,
          network: 'local production assets, warm cache',
          longTasks: tasks,
        },
        null,
        2,
      ),
    );
    expect(tasks.filter((ms) => ms > 50).length).toBeLessThanOrEqual(1);
    await page.locator('#approach').evaluate((el) => {
      const r = el.getBoundingClientRect();
      scrollTo(0, r.top + scrollY - innerHeight * 0.75 + 0.5 * r.height);
    });
    await page.reload();
    await expect(page.locator('main')).toHaveAttribute('data-enhanced', 'true');
    await expect
      .poll(() =>
        page.locator('#approach').evaluate((el) => {
          const actual = Number((el as HTMLElement).style.getPropertyValue('--progress'));
          const items = [...el.querySelectorAll<HTMLElement>('article')];
          const expected =
            items.reduce(
              (sum, item) => sum + Number(item.style.getPropertyValue('--item-progress')),
              0,
            ) / items.length;
          return Math.abs(actual - expected);
        }),
      )
      .toBeLessThan(0.02);
    await page.setViewportSize({ width: width === 375 ? 420 : 1280, height: 800 });
    const win = await cdp.send('Runtime.evaluate', { expression: 'window' });
    const listeners = await cdp.send('DOMDebugger.getEventListeners', {
      objectId: win.result.objectId!,
    });
    const before = listeners.listeners.filter((l) => l.type === 'scroll').length;
    await page.getByRole('link', { name: 'Посмотреть расписание' }).click();
    await expect(page).toHaveURL(/#schedule$/);
    await expect
      .poll(
        async () =>
          (
            await cdp.send('DOMDebugger.getEventListeners', { objectId: win.result.objectId! })
          ).listeners.filter((l) => l.type === 'scroll').length,
      )
      .toBe(before);
    await page
      .locator('#schedule')
      .getByRole('link', { name: 'Оставить общую заявку', exact: true })
      .click();
    await expect(page).toHaveURL(/\/enquiry$/);
    await expect
      .poll(
        async () =>
          (
            await cdp.send('DOMDebugger.getEventListeners', { objectId: win.result.objectId! })
          ).listeners.filter((l) => l.type === 'scroll').length,
      )
      .toBeLessThan(before);
    await context.close();
  }
});
