import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const documents: Record<'privacy' | 'terms', Array<{ type: string; text: string }>> = JSON.parse(
  readFileSync(new URL('../app/content/legal-documents.json', import.meta.url), 'utf8'),
);

for (const [name, path] of [
  ['privacy', 'legal/privacy'],
  ['terms', 'legal/terms'],
] as const) {
  test(`${name}: документ доступен без JavaScript и содержит все исходные блоки`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 375, height: 812 },
    });
    const page = await context.newPage();
    const response = await page.goto(new URL(path, baseURL).toString());
    expect(response?.status()).toBe(200);
    const blocks = await page.locator('main.legal-document').evaluate((main) =>
      [...main.querySelectorAll('h1,h2,p,li')].map((element) => ({
        type:
          element.tagName === 'LI' ? 'item' : element.tagName === 'H2' ? 'heading' : 'paragraph',
        text: element.textContent,
      })),
    );
    expect(blocks).toEqual(documents[name]);
    await page.reload();
    await expect(page.locator('main h1')).toHaveText(documents[name][0].text);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('link', { name: 'На главную', exact: true }).click();
    await expect(
      page.locator('footer').getByRole('link', { name: documents[name][0].text, exact: true }),
    ).toBeVisible();
    await context.close();
  });
}
