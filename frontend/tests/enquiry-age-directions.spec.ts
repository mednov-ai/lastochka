import { expect, test, type Page } from '@playwright/test';

const fixture = process.env.ENQUIRY_FIXTURE_URL ?? 'http://127.0.0.1:48797';
const mode = (value: string) => fetch(`${fixture}/__fixture/mode?mode=${value}`);
const last = async () => (await (await fetch(`${fixture}/__fixture/state`)).json()).last;
const direction = (n: number) => `b8c0a000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const session = (n: number) => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, '0')}`;
const sizes = [
  { width: 375, height: 760 },
  { width: 1440, height: 900 },
];

async function contacts(page: Page) {
  await page.getByLabel('Ваше имя').fill('Анна');
  await page.getByRole('textbox', { name: 'Телефон' }).pressSequentially('9001234567');
}
const options = (page: Page) => page.locator('.enquiry-option:visible');
const choice = (page: Page) => page.locator('.enquiry-session-choice');

test.beforeEach(async () => {
  await mode('full');
});

for (const size of sizes) {
  test.describe(`${size.width}px`, () => {
    test.use({ viewport: size });

    test('общая заявка: имя, телефон и категория, выбор занятия свёрнут', async ({ page }) => {
      await page.goto('/enquiry');
      await expect(page.getByRole('group', { name: 'Возрастная категория' })).toBeVisible();
      await expect(page.getByText('Для ребёнка')).toHaveCount(0);
      await expect(page.getByLabel('Возраст ребёнка')).toHaveCount(0);
      await expect(choice(page)).not.toHaveAttribute('open', '');
      await contacts(page);
      await page.getByRole('radio', { name: '14+ лет', exact: true }).check();
      await page.getByLabel('Кто будет заниматься — необязательно').fill('Анна');
      await page.getByRole('button', { name: 'Отправить заявку' }).click();
      await expect(page.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();
      const sent = await last();
      expect(sent.body).toMatchObject({
        contractVersion: 3,
        ageDirectionId: direction(5),
        participantName: 'Анна',

      });
      expect(sent.body).not.toHaveProperty('desiredSessionId');
      expect(sent.body).not.toHaveProperty('calculatedSession');
      expect(sent.body).not.toHaveProperty('participantType');
      expect(sent.body).not.toHaveProperty('childAge');
    });

    test('без категории форма не отправляется и сообщает о выборе', async ({ page }) => {
      await page.goto('/enquiry');
      await contacts(page);
      await page.getByRole('button', { name: 'Отправить заявку' }).click();
      await expect(page.locator('.form-validation')).toContainText(
        'Возрастная категория: Выберите значение из списка.',
      );
      await expect(page.locator('.form-validation .field-error')).toHaveCount(1);
      expect(await last()).toBeNull();
      // Выбор не первой категории снимает ошибку всей группы, и форма отправляется.
      await page.getByRole('radio', { name: '10–13 лет', exact: true }).check();
      await expect(page.locator('.form-validation .field-error')).toHaveCount(0);
      await page.getByRole('button', { name: 'Отправить заявку' }).click();
      await expect(page.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();
      expect((await last()).body.ageDirectionId).toBe(direction(4));
    });

    test('выбор занятия без перезагрузки, фильтр по категории и смена категории', async ({
      page,
    }) => {
      await page.goto('/enquiry');
      await contacts(page);
      await page.getByRole('radio', { name: '6–7 лет', exact: true }).check();
      await choice(page).locator('summary').click();
      // «Помогите подобрать время» и пять первых занятий категории.
      await expect(options(page)).toHaveCount(6);
      const navigations: string[] = [];
      page.on('framenavigated', (frame) => navigations.push(frame.url()));
      await page.getByRole('button', { name: 'Показать ещё' }).click();
      await expect(options(page)).toHaveCount(9);
      const picked = options(page).nth(3);
      await picked.click();
      await expect(choice(page).locator('summary')).toContainText('Выбрано:');
      // Выбор не перезагружает страницу и не уводит к её началу.
      await expect(picked).toBeInViewport();
      await expect(picked.locator('input')).toBeChecked();
      expect(navigations).toEqual([]);
      await page.getByRole('radio', { name: '8–9 лет', exact: true }).check();
      await expect(page.locator('.enquiry-choice-body [role="status"]')).toContainText(
        'выбор снят',
      );
      await expect(options(page)).toHaveCount(3);
      await options(page).nth(1).click();
      await page.getByRole('button', { name: 'Отправить заявку' }).click();
      await expect(page.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();
      expect((await last()).body).toMatchObject({
        ageDirectionId: direction(3),
        weeklyPreference: {seriesId: session(20), revision: 1},
      });
    });
  });
}

test('переход с карточки афиши предвыбирает занятие и категорию', async ({ page }) => {
  await page.goto(`/enquiry?weekly=weekly|${session(22)}|1`);
  await expect(page.getByRole('radio', { name: '10–13 лет' })).toBeChecked();
  await expect(choice(page)).toHaveAttribute('open', '');
  await expect(page.locator('.enquiry-option input:checked')).toHaveValue(
    `weekly|${session(22)}|1`,
  );
});

test('ссылка строки афиши предвыбирает только категорию', async ({ page }) => {
  await page.goto(`/enquiry?direction=${direction(2)}`);
  await expect(page.getByRole('radio', { name: '6–7 лет' })).toBeChecked();
  await expect(choice(page)).not.toHaveAttribute('open', '');
});

test('закрытое или неизвестное занятие из ссылки не выбирается', async ({ page }) => {
  await page.goto(`/enquiry?session=${session(23)}`);
  await expect(page.getByText('Ссылка вела на занятие по дате.', {exact:false})).toBeVisible();
  await expect(page.locator('input[name="ageDirectionId"]:checked')).toHaveCount(0);
});

test('изменившееся занятие даёт конфликт с сохранением полей', async ({ page }) => {
  await page.goto('/enquiry');
  await contacts(page);
  await page.getByRole('radio', { name: '6–7 лет', exact: true }).check();
  await page.getByLabel('Комментарий — необязательно').fill('После обеда');
  await choice(page).locator('summary').click();
  await options(page).nth(1).click();
  await mode('weekly-conflict');
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByRole('alert')).toContainText('Условия выбранного занятия изменились');
  await expect(page.getByLabel('Ваше имя')).toHaveValue('Анна');
  await expect(page.getByLabel('Комментарий — необязательно')).toHaveValue('После обеда');
  await expect(page.getByRole('radio', { name: '6–7 лет' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Помогите подобрать время' })).toBeChecked();
  expect(await last()).toBeNull();
});

test('архивная категория: ошибка поля и сохранение ввода', async ({ page }) => {
  await page.goto('/enquiry');
  await contacts(page);
  await page.getByRole('radio', { name: '3–5 лет', exact: true }).check();
  await mode('archived');
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.locator('#direction-error')).toHaveText(
    'Выберите возрастную категорию из списка.',
  );
  await expect(page.getByLabel('Ваше имя')).toHaveValue('Анна');
});

test('пустой список и ошибка расписания различаются', async ({ page }) => {
  await mode('empty');
  await page.goto('/enquiry');
  await page.getByRole('radio', { name: '8–9 лет', exact: true }).check();
  await choice(page).locator('summary').click();
  await expect(page.locator('.enquiry-empty:visible')).toHaveCount(1);
  await mode('error');
  await page.goto('/enquiry');
  await page.getByRole('radio', { name: '8–9 лет', exact: true }).check();
  await choice(page).locator('summary').click();
  await expect(page.getByText('Не удалось загрузить расписание')).toBeVisible();
  await expect(page.locator('.enquiry-empty:visible')).toHaveCount(0);
});

test('справочник недоступен: понятная ошибка и повтор', async ({ page }) => {
  await mode('age-error');
  await page.goto('/enquiry');
  await expect(page.getByText('Не удалось загрузить возрастные категории')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Повторить' })).toBeVisible();
});

test.describe('без JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('фильтр по категории и отправка с выбором занятия', async ({ page, browserName }) => {
    await page.goto('/enquiry');
    await page.getByLabel('Ваше имя').fill('Анна');
    await page.locator('input[name="phoneNational"]').fill('9001234567');
    await page.getByRole('radio', { name: '8–9 лет', exact: true }).check();
    await choice(page).locator('summary').click();
    // Фильтр работает на :has(): видны «Помогите подобрать время» и два занятия 8–9 лет.
    await expect(options(page)).toHaveCount(3);
    await options(page).nth(2).click();
    await page.getByRole('button', { name: 'Отправить заявку' }).click();
    await expect(page.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();
    expect((await last()).body).toMatchObject({
      ageDirectionId: direction(3),
      weeklyPreference: {seriesId: session(21), revision: 1},
    });
    expect(page.url()).not.toContain('9001234567');
    void browserName;
  });
});

test('постоянная афиша передаёт в заявку день, время и категорию без даты', async ({ page }) => {
  await page.goto('/');
  await page.locator('#schedule .poster-time:visible').first().click();
  await expect(page.locator('input[name="ageDirectionId"]:checked')).toHaveValue(direction(1));
  await expect(page.locator('input[name="desiredChoice"]:checked')).toHaveValue('weekly|' + direction(1) + '|3');
  await expect(page.locator('.enquiry-option:visible').filter({hasText:'Среда, 17:00'})).toContainText('Среда, 17:00–17:45');
  await contacts(page);
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByRole('heading',{name:'Заявка принята'})).toBeVisible();
  expect((await last()).body.weeklyPreference).toEqual({seriesId:direction(1),revision:3});
});

test('пустая афиша даёт путь в общую заявку', async ({ page }) => {
  await mode('empty');
  await page.goto('/');
  await expect(page.locator('#schedule')).toContainText('Постоянное время пока не опубликовано');
  await expect(page.locator('#schedule input[type="date"]')).toHaveCount(0);
  await page.locator('#schedule').getByRole('link',{name:'Оставить заявку',exact:true}).first().click();
  await expect(page.getByRole('heading',{name:'Заявка на занятие'})).toBeVisible();
});

test('повтор после ошибки загружает постоянную афишу', async ({ page }) => {
  await mode('error');
  await page.goto('/#schedule');
  const section = page.locator('#schedule');
  await expect(section.getByRole('alert')).toContainText('Не удалось загрузить расписание');
  await mode('full');
  await section.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(section.locator('.poster-time:visible').first()).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#schedule');
});

for (const js of [true, false]) {
  test.describe('пожелание, JavaScript=' + js, () => {
    test.use({ javaScriptEnabled: js });
    test('при изменении времени сохраняются контакты и снимается выбор', async ({ page }) => {
      await page.goto('/enquiry?weekly=' + encodeURIComponent('weekly|' + direction(1) + '|3'));
      await contacts(page);
      await page.getByLabel('Комментарий — необязательно').fill('Удобно вечером');
      await mode('weekly-conflict');
      await page.getByRole('button', { name: 'Отправить заявку' }).click();
      await expect(page.getByRole('alert')).toContainText('Условия выбранного занятия изменились');
      await expect(page.getByLabel('Ваше имя')).toHaveValue('Анна');
      await expect(page.getByLabel('Комментарий — необязательно')).toHaveValue('Удобно вечером');
      await expect(page.getByRole('radio', { name: 'Помогите подобрать время' })).toBeChecked();
      await mode('full');
      await page.getByRole('radio', { name: '6–7 лет', exact: true }).check();
      await page.getByRole('button', { name: 'Отправить заявку' }).click();
      await expect(page.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();
      expect((await last()).body.ageDirectionId).toBe(direction(2));
      expect((await last()).body.weeklyPreference).toBeUndefined();
    });
  });
}
