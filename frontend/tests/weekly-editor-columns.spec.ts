import { expect, test } from '@playwright/test';

test('время, категория и действие выровнены между днями недели', async ({ page }) => {
  const directions = [
    { id: 'younger', title: '3–5 лет', active: true },
    { id: 'older', title: '10–13 лет', active: true },
  ];
  const intervals = [1, 2].flatMap((weekday) =>
    [0, 1, 2].map((column) => ({
      weekday,
      startMinute: 960 + column * 60,
      durationMinutes: 45,
      directionId: directions[(weekday + column) % 2].id,
      reference: { seriesId: `slot-${weekday}-${column}`, revision: 1 },
    })),
  );
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ json: { state: 'FULL', account: { id: 'admin', role: 'ADMIN', permissions: [] } } }),
  );
  await page.route('**/api/v1/admin/schedule/weekly', (route) =>
    route.fulfill({ json: { directions, intervals } }),
  );
  await page.goto('/admin/schedule');
  const days = page.locator('.weekly-day');
  await expect(days).toHaveCount(7);
  await page.evaluate(() => document.fonts.ready);
  for (let column = 0; column < 3; column++) {
    const monday = days.nth(0).getByRole('listitem').nth(column);
    const tuesday = days.nth(1).getByRole('listitem').nth(column);
    for (const selector of ['strong', 'span', 'button']) {
      const first = await monday.locator(selector).boundingBox();
      const second = await tuesday.locator(selector).boundingBox();
      expect(first).toBeTruthy();
      expect(second).toBeTruthy();
      expect(Math.abs(first!.x - second!.x)).toBeLessThanOrEqual(1);
    }
  }
});
