import { expect, test } from '@playwright/test';

test('недельная таблица показывает все страницы и не выдумывает пустые дни', async ({ page }) => {
  await page.route('**/api/v1/public/schedule?*', async (route) => {
    const query = new URL(route.request().url()).searchParams;
    const selectedPage = Number(query.get('page'));
    const start = new Date(query.get('from')!);
    start.setUTCHours(start.getUTCHours() + 12);
    const session = (index: number) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      title: `Проверочное занятие ${index + 1}`,
      format: 'GROUP',
      capacity: 8,
      ageFrom: 14,
      ageTo: null,
      ageOpenEnded: true,
      startsAt: start.toISOString(),
      endsAt: new Date(start.valueOf() + 3600000).toISOString(),
      status: 'OPEN',
      version: 1,
      zone: 'Europe/Moscow',
    });
    await route.fulfill({
      json: {
        // Answer with the page size the client asks for, as the real API does.
        items: Array.from({ length: 21 }, (_, i) => session(i))
          .slice(
            selectedPage * Number(query.get('size')),
            (selectedPage + 1) * Number(query.get('size')),
          )
          .map((item) => ({ kind: 'SESSION', session: item })),
        page: selectedPage,
        size: Number(query.get('size')),
        total: 21,
        containsCalculated: false,
      },
    });
  });
  await page.goto('./');
  const schedule = page.locator('#schedule');
  await schedule.getByRole('button', { name: 'Следующая неделя', exact: true }).click();
  // polish-public-site-per-client-review: the poster shows the whole week without pages.
  await expect(
    schedule.locator('.poster-days a.poster-time:visible, .poster-table a.poster-time:visible'),
  ).toHaveCount(21);
  await expect(schedule.getByText('Проверочное занятие 21')).toBeVisible();
  await expect(schedule.getByText('14+ лет').first()).toBeVisible();
  await expect(schedule.getByText('Мини-группа до 8 человек')).toHaveCount(0);
  await expect(
    schedule.getByText('Показана часть занятий за неделю.', { exact: false }),
  ).toHaveCount(0);
  await expect(schedule.getByRole('button', { name: 'Далее', exact: true })).toHaveCount(0);
});

test('выбор участника сохраняет введённые данные без JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 375, height: 844 },
  });
  const page = await context.newPage();
  await page.goto(new URL('enquiry', baseURL).toString());
  await page.getByLabel('Ваше имя').fill('Проверка');
  await page.getByLabel('Имя ребёнка').fill('Анна');
  await page.getByLabel('Возраст ребёнка').fill('8');
  await page.getByRole('button', { name: 'Для себя' }).click();
  await expect(page.getByLabel('Ваш возраст')).toBeVisible();
  await expect(page.getByLabel('Ваше имя')).toHaveValue('Проверка');
  await page.getByRole('button', { name: 'Для ребёнка' }).click();
  await expect(page.getByLabel('Имя ребёнка')).toHaveValue('Анна');
  await expect(page.getByLabel('Возраст ребёнка')).toHaveValue('8');
  await context.close();
});
