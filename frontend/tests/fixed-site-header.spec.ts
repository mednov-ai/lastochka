import { expect, test } from '@playwright/test';

for (const javaScriptEnabled of [true, false]) {
  test(`шапка и якорь доступны при прокрутке: JavaScript ${javaScriptEnabled}`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled });
    const page = await context.newPage();
    for (const width of [320, 375, 1000, 1001, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(new URL('legal/privacy', baseURL).toString());
      const header = page.locator('.header');
      for (const position of [0, 0.5, 1, 0]) {
        await page.evaluate(
          (fraction) => scrollTo(0, document.body.scrollHeight * fraction),
          position,
        );
        expect(Math.abs((await header.boundingBox())!.y)).toBeLessThan(1);
      }
      await page.goto(new URL('#schedule', baseURL).toString());
      const bounds = await page.evaluate(() => ({
        headerBottom: document.querySelector('.header')!.getBoundingClientRect().bottom,
        targetTop: document.querySelector('#schedule')!.getBoundingClientRect().top,
        overflow: document.documentElement.scrollWidth > innerWidth,
      }));
      expect(bounds.targetTop).toBeGreaterThanOrEqual(bounds.headerBottom - 1);
      expect(bounds.overflow).toBe(false);
    }
    await context.close();
  });
}
