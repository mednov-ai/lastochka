import { expect, test, type Page } from '@playwright/test';

const fixture = process.env.PERMANENT_FIXTURE_URL ?? 'http://127.0.0.1:48674';
const series = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const date = '2080-01-01';
const link = `/enquiry?series=${series}&date=${date}&revision=1`;

async function contact(page: Page) {
  await page.getByLabel('Ваше имя').fill('Проверка');
  await page.getByLabel('Телефон').fill('9001234567');
  await page.getByRole('button', { name: 'Для себя' }).click();
  await page.getByLabel('Ваш возраст').fill('34');
}

test.beforeEach(async ({ request }) => { await request.get(`${fixture}/__fixture/reset?mode=virtual`); });

test('возрастные направления обновляются без пересборки, а ошибка не скрывает фотографии', async ({ page, request }) => {
  await page.goto('/');
  const ages = page.locator('#age-groups');
  await expect(ages.getByRole('heading', { name: '8–9 лет' })).toBeVisible();
  await request.get(`${fixture}/__fixture/mode?mode=age-updated`);
  await page.reload();
  await expect(ages.getByRole('heading', { name: '8–10 лет' })).toBeVisible();
  await expect(page.locator('.landing-hero-photo img')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Сообщество ВКонтакте' }).first()).toHaveAttribute('href', 'https://vk.ru/lastochkagym');
  await request.get(`${fixture}/__fixture/mode?mode=age-error`);
  await page.reload();
  await expect(ages.getByRole('status')).toContainText('Не удалось загрузить возрастные направления');
  await expect(page.locator('.landing-hero-photo img')).toBeVisible();
});

test('дальняя неделя показывает расчётную дату и открывает заявку', async ({ page }) => {
  await page.goto('/');
  const schedule = page.locator('#schedule');
  await expect(schedule.locator('.poster-footer')).toBeVisible();
  await schedule.getByLabel('Дата', { exact: true }).fill(date);
  // polish-public-site-per-client-review: times on the poster are the enquiry links.
  const slot = schedule.locator('a.poster-time:visible');
  await expect(slot).toHaveCount(1);
  await expect(slot).toHaveAccessibleName(/8–9 лет/);
  await expect(schedule).not.toContainText('8 человек');
  await slot.click();
  await expect(page.locator('input[name="desiredSeriesId"]')).toHaveValue(series);
  await expect(page.locator('input[name="desiredOriginalDate"]')).toHaveValue(date);
  await expect(page.locator('input[name="desiredSessionId"]')).toHaveValue('');
  await expect(page.getByLabel('Желаемое занятие')).toContainText('8–9 лет');
});

test('существующее занятие выбирается по прежнему идентификатору', async ({ page, request }) => {
  await request.get(`${fixture}/__fixture/mode?mode=realized`);
  await page.goto('/');
  const schedule = page.locator('#schedule');
  await expect(schedule.locator('.poster-footer')).toBeVisible();
  await schedule.getByLabel('Дата', { exact: true }).fill(date);
  await schedule.locator('a.poster-time:visible').click();
  await expect(page.locator('input[name="desiredSessionId"]')).toHaveValue('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  await expect(page.locator('input[name="desiredSessionVersion"]')).toHaveValue('1');
  await expect(page.getByLabel('Желаемое занятие')).toContainText('Мини-группа до 8 человек');
});

test('заявка без JavaScript сохраняет выбор и использует уже созданную дату', async ({ browser, request, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 844 } });
  const page = await context.newPage();
  await page.goto(new URL(link, baseURL).toString());
  await contact(page);
  await request.get(`${fixture}/__fixture/mode?mode=realized`);
  await page.getByRole('button', { name: 'Отправить заявку', exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();
  const state = await (await request.get(`${fixture}/__fixture/state`)).json();
  expect(state.submissions).toHaveLength(1);
  expect(state.submissions[0].calculatedSession).toMatchObject({ seriesId: series, originalDate: date, seriesVersion: 1, referenceVersion: 1 });
  expect(state.submissions[0].desiredSessionId).toBeNull();
  await context.close();
});

test('ссылка на расчётную дату работает, если занятие уже создано', async ({ page, request }) => {
  await request.get(`${fixture}/__fixture/mode?mode=realized`);
  await page.goto(link);
  await expect(page.locator('input[name="desiredSessionVersion"]')).toHaveValue('');
  await expect(page.locator('input[name="desiredSeriesId"]')).toHaveValue(series);
  await contact(page);
  await page.getByRole('button', { name: 'Отправить заявку', exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();
  const state = await (await request.get(`${fixture}/__fixture/state`)).json();
  expect(state.submissions).toHaveLength(1);
  expect(state.submissions[0].desiredSessionVersion).toBeNull();
  expect(state.submissions[0].calculatedSession).toMatchObject({ seriesId: series, originalDate: date, seriesVersion: 1 });
});

test('повтор после потерянного ответа возвращает прежнюю заявку даже при изменении расписания', async ({ page, request }) => {
  await page.goto(link);
  await contact(page);
  await request.get(`${fixture}/__fixture/mode?mode=lost-response`);
  await page.getByRole('button', { name: 'Отправить заявку', exact: true }).filter({ visible: true }).click();
  await expect(page.getByText(/Повторите отправку с теми же данными/)).toBeVisible();
  await expect(page.locator('input[name="uncertain"]')).toHaveValue('true');
  await request.get(`${fixture}/__fixture/mode?mode=stale`);
  await page.getByRole('button', { name: 'Отправить заявку', exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();
  expect((await (await request.get(`${fixture}/__fixture/state`)).json()).submissions).toHaveLength(1);
});

test('без JavaScript можно выбрать расчётную дату из формы', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 375, height: 844 } });
  const page = await context.newPage();
  await page.goto(new URL('/enquiry', baseURL).toString());
  await page.getByLabel('Ваше имя').fill('Проверка');
  await page.getByRole('button', { name: 'Выбрать занятие' }).click();
  await page.getByLabel('Показать с').fill(date);
  await page.getByRole('button', { name: 'Показать занятия' }).click();
  await page.getByRole('button', { name: /Выбрать занятие: 8–9 лет/ }).click();
  await expect(page.locator('input[name="desiredSeriesId"]')).toHaveValue(series);
  await expect(page.getByLabel('Ваше имя')).toHaveValue('Проверка');
  await context.close();
});

test('неполный ответ и ошибка не выдаются за пустую неделю', async ({ page, request }) => {
  await request.get(`${fixture}/__fixture/mode?mode=incomplete`);
  await page.goto('/');
  const schedule = page.locator('#schedule');
  await expect(schedule.locator('.poster-footer')).toBeVisible();
  await schedule.getByLabel('Дата', { exact: true }).fill(date);
  await expect(schedule.getByRole('alert')).toContainText('Не удалось загрузить расписание');
  await expect(schedule.locator('.poster-footer')).toHaveCount(0);
  await expect(schedule.getByText('Набираем групп')).toHaveCount(0);
  await request.get(`${fixture}/__fixture/mode?mode=error`);
  await schedule.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(schedule.getByRole('alert')).toContainText('Расписание временно недоступно');
  await expect(schedule.getByText('Набираем групп')).toHaveCount(0);
});

test('страницы большой недели сохраняют все занятия', async ({ page, request }) => {
  await request.get(`${fixture}/__fixture/mode?mode=many`);
  await page.goto('/');
  const schedule = page.locator('#schedule');
  await expect(schedule.locator('.poster-footer')).toBeVisible();
  await schedule.getByLabel('Дата', { exact: true }).fill(date);
  // The poster shows the whole week at once instead of pages.
  await expect(schedule.locator('a.poster-time:visible')).toHaveCount(25);
  await expect(schedule.getByText('Группа 1', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(schedule.getByText('Группа 25', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(schedule.getByRole('navigation', { name: 'Расписание: страницы' })).toHaveCount(0);
});

test('изменение или отмена до отправки не стирает введённые данные', async ({ page, request }) => {
  await page.goto(link);
  await contact(page);
  await request.get(`${fixture}/__fixture/mode?mode=stale`);
  await page.getByRole('button', { name: 'Отправить заявку', exact: true }).filter({ visible: true }).click();
  await expect(page.getByText(/Выбранное занятие изменилось или недоступно/)).toBeVisible();
  await expect(page.getByLabel('Ваше имя')).toHaveValue('Проверка');
  await expect(page.getByLabel('Ваш возраст')).toHaveValue('34');
  await expect(page.getByRole('button', { name: 'Выбрать актуальные условия' })).toBeVisible();
  expect((await (await request.get(`${fixture}/__fixture/state`)).json()).submissions).toHaveLength(0);
  await request.get(`${fixture}/__fixture/mode?mode=cancelled`);
  await page.getByRole('button', { name: 'Выбрать актуальные условия' }).click();
  await expect(page.getByText(/Это занятие недоступно/)).toBeVisible();
  await expect(page.getByLabel('Ваше имя')).toHaveValue('Проверка');
});
