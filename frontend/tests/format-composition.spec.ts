import { test, expect, type Locator } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { base } from './support/actors';
const output = resolve(process.env.TEST_ARTIFACT_DIR ?? '../artifacts/format-card-composition');
mkdirSync(output, { recursive: true });
// Manually reviewed head regions in original pixels, including the entire crown/face.
// Source review is recorded in docs/format-card-composition.md; geometry alone cannot detect a cropped source.
const subjects = [
  {
    file: 'mini-group-v2.webp',
    width: 1344,
    height: 704,
    heads: [
      { name: 'trainer', box: [516, 118, 612, 235] },
      { name: 'left child', box: [211, 294, 287, 382] },
      { name: 'left-middle child', box: [350, 294, 426, 377] },
      { name: 'middle-right child', box: [755, 303, 827, 384] },
      { name: 'front boy', box: [910, 288, 991, 388] },
      { name: 'right child', box: [1080, 299, 1163, 393] },
    ],
  },
  {
    file: 'individual.webp',
    width: 1600,
    height: 900,
    heads: [
      { name: 'seated child', box: [290, 306, 466, 521] },
      { name: 'exercising child', box: [928, 215, 1138, 421] },
    ],
  },
  {
    file: 'hero.webp',
    width: 1600,
    height: 900,
    heads: [
      { name: 'trainer', box: [1204, 32, 1316, 159] },
      { name: 'left boy', box: [516, 422, 620, 536] },
      { name: 'middle girl', box: [784, 405, 906, 533] },
      { name: 'back boy', box: [1142, 441, 1223, 528] },
      { name: 'right girl', box: [1304, 433, 1439, 570] },
    ],
  },
];
async function review(card: Locator, index: number) {
  const expected = subjects[index];
  const result = await card.evaluate((el, expected) => {
    const image = el.querySelector('img')!,
      frame = el.querySelector('.format-art')!,
      number = frame.querySelector('span')!;
    const imageBox = image.getBoundingClientRect(),
      frameBox = frame.getBoundingClientRect(),
      cardBox = el.getBoundingClientRect(),
      numberBox = number.getBoundingClientRect();
    const css = getComputedStyle(image),
      cardCss = getComputedStyle(el),
      frameCss = getComputedStyle(frame);
    const scale = Math.min(
      imageBox.width / image.naturalWidth,
      imageBox.height / image.naturalHeight,
    );
    const left = imageBox.left + (imageBox.width - image.naturalWidth * scale) / 2;
    const top = imageBox.top + (imageBox.height - image.naturalHeight * scale) / 2;
    const radius = parseFloat(cardCss.borderTopLeftRadius);
    function visible(x: number, y: number) {
      if (x < frameBox.left || x > frameBox.right || y < frameBox.top || y > frameBox.bottom)
        return false;
      for (const cx of [cardBox.left + radius, cardBox.right - radius]) {
        const outer = cx === cardBox.left + radius ? x < cx : x > cx;
        if (
          outer &&
          y < cardBox.top + radius &&
          Math.hypot(x - cx, y - (cardBox.top + radius)) > radius
        )
          return false;
      }
      return true;
    }
    return {
      source: image.getAttribute('src'),
      width: image.naturalWidth,
      height: image.naturalHeight,
      fit: css.objectFit,
      transform: css.transform,
      clip: frameCss.clipPath,
      ratio: frameBox.width / frameBox.height,
      heads: expected.heads.map((h) => {
        const [x1, y1, x2, y2] = h.box;
        const rect = {
          left: left + x1 * scale,
          top: top + y1 * scale,
          right: left + x2 * scale,
          bottom: top + y2 * scale,
        };
        return {
          name: h.name,
          topClearance: rect.top - frameBox.top,
          inside: [
            [rect.left, rect.top],
            [rect.right, rect.top],
            [rect.left, rect.bottom],
            [rect.right, rect.bottom],
          ].every(([x, y]) => visible(x, y)),
          overlapsNumber:
            rect.left < numberBox.right &&
            rect.right > numberBox.left &&
            rect.top < numberBox.bottom &&
            rect.bottom > numberBox.top,
        };
      }),
    };
  }, expected);
  expect(result.source).toMatch(new RegExp('/' + expected.file.replaceAll('.', '\\.') + '$'));
  expect([result.width, result.height]).toEqual([expected.width, expected.height]);
  expect(result.fit).toBe('contain');
  expect(result.transform).toBe('none');
  expect(result.clip).toBe('none');
  expect(result.ratio).toBeCloseTo(16 / 9, 2);
  for (const head of result.heads) {
    expect(head.inside, head.name + ' is outside the visible mask').toBe(true);
    expect(head.topClearance, head.name + ' top clearance').toBeGreaterThan(3);
    expect(head.overlapsNumber, head.name + ' is overlapped by the badge').toBe(false);
  }
  return result;
}
async function loaded(page: import('@playwright/test').Page) {
  await page.goto(base + '/#formats');
  for (const image of await page.locator('.format-card img').all()) {
    await image.scrollIntoViewIfNeeded();
    await image.evaluate((img) => (img as HTMLImageElement).decode());
  }
  await page.evaluate(() => document.fonts.ready);
}
test('all format subjects fit their rounded frames across responsive widths', async ({ page }) => {
  test.setTimeout(120000);
  const results = [];
  for (const width of [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920])
    for (const height of [700, 1000]) {
      await page.setViewportSize({ width, height });
      await loaded(page);
      for (let i = 0; i < 3; i++) {
        const card = page.locator('.format-card').nth(i);
        await card.scrollIntoViewIfNeeded();
        const result = await review(card, i);
        results.push({ viewport: { width, height }, index: i, ...result });
        await card
          .locator('.format-art')
          .screenshot({ path: resolve(output, `media-${width}-${height}-${i}.png`) });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (height === 1000 && [390, 1440].includes(width))
        await page
          .locator('#formats')
          .screenshot({ path: resolve(output, `formats-${width}.png`) });
    }
  writeFileSync(resolve(output, 'composition-matrix.json'), JSON.stringify(results, null, 2));
});
test('heads remain visible through all scroll phases, hover, keyboard and reverse', async ({
  browser,
}) => {
  test.setTimeout(120000);
  const records = [];
  for (const width of [375, 390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }),
      page = await context.newPage();
    await loaded(page);
    for (const progress of [0, 0.25, 0.5, 0.75, 1, 0.5]) {
      await page.locator('#formats').evaluate((el, p) => {
        const r = el.getBoundingClientRect();
        scrollTo(0, r.top + scrollY - innerHeight * 0.75 + p * r.height);
      }, progress);
      await expect
        .poll(() =>
          page
            .locator('#formats')
            .evaluate((el) => Number((el as HTMLElement).style.getPropertyValue('--progress'))),
        )
        .toBeCloseTo(progress, 2);
      for (let i = 0; i < 3; i++)
        records.push({
          viewportWidth: width,
          progress,
          index: i,
          ...(await review(page.locator('.format-card').nth(i), i)),
        });
      await page.screenshot({ path: resolve(output, `phase-${width}-${progress * 100}.png`) });
    }
    for (let i = 0; i < 3; i++) {
      const card = page.locator('.format-card').nth(i);
      await card.scrollIntoViewIfNeeded();
      // Scrolling settles the outer card before checking pointer reactions.
      await page.waitForTimeout(100);
      const before = await card.boundingBox();
      await card.hover();
      await expect(card).toHaveCSS('border-color', 'rgb(123, 184, 181)');
      await review(card, i);
      const hover = await card.boundingBox();
      expect(hover?.width).toBeCloseTo(before!.width, 1);
      expect(hover?.y).toBeCloseTo(before!.y, 1);
      await card
        .locator('.format-art')
        .screenshot({ path: resolve(output, `hover-${width}-${i}.png`) });
      await page.mouse.move(0, 0);
      await expect(card).toHaveCSS('border-color', 'rgb(205, 228, 224)');
      await review(card, i);
      await card.getByRole('link', { name: 'Выбрать занятие' }).focus();
      await expect(card).toHaveCSS('border-color', 'rgb(16, 102, 106)');
      await review(card, i);
      await card.getByRole('link').blur();
    }
    await context.close();
  }
  writeFileSync(resolve(output, 'composition-phases.json'), JSON.stringify(records, null, 2));
});
test('static, reduced-motion and touch keep the same full subjects and functional CTAs', async ({
  browser,
}) => {
  for (const mode of ['nojs', 'reduce', 'touch'] as const) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      javaScriptEnabled: mode !== 'nojs',
      reducedMotion: mode === 'reduce' ? 'reduce' : 'no-preference',
      hasTouch: mode === 'touch',
      isMobile: mode === 'touch',
    });
    const p = await context.newPage();
    await loaded(p);
    for (let i = 0; i < 3; i++) await review(p.locator('.format-card').nth(i), i);
    const link = p.locator('.format-card').first().getByRole('link', { name: 'Выбрать занятие' });
    if (mode === 'touch') await link.tap();
    else await link.click();
    await expect(p.getByRole('heading', { name: 'Заявка на занятие' })).toBeVisible();
    await expect(p).toHaveURL(/\/enquiry$/);
    await context.close();
  }
});
