import { expect, test } from '@playwright/test';

const fixture = 'http://127.0.0.1:48694';
const series = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const session = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

for (const query of [
  new URLSearchParams({ series, date: '2080-01-01', revision: '1' }),
  new URLSearchParams({ session }),
]) {
  test(`Старая ссылка открывает явный выбор: ${query.keys().next().value}`, async ({
    page,
    request,
  }) => {
    await request.get(fixture + '/__fixture/reset');
    await page.goto('/enquiry?' + query);
    await expect(page.getByText('Ссылка вела на занятие по дате.', { exact: false })).toBeVisible();
    await expect(page.locator('input[name="desiredChoice"]:checked')).toHaveValue('');
    await expect(page.locator('input[name="ageDirectionId"]:checked')).toHaveCount(0);
    await page.getByLabel('Ваше имя').fill('Проверка');
    await page.getByRole('textbox', { name: 'Телефон' }).pressSequentially('9001234567');
    await page.getByRole('radio', { name: '8–9 лет', exact: true }).check();
    await page.getByRole('button', { name: 'Отправить заявку' }).click();
    await expect(page.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();
    const state = await (await request.get(fixture + '/__fixture/state')).json();
    expect(state.submissions).toHaveLength(1);
    for (const field of ['desiredSessionId', 'calculatedSession', 'weeklyPreference'])
      expect(state.submissions[0]).not.toHaveProperty(field);
  });
}
