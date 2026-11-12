import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const account = {
  id: 'self',
  login: 'admin',
  name: 'Администратор',
  role: 'ADMIN',
  roles: ['ADMIN'],
};
const start = new Date(Date.now() - 3600000);
const session = {
  id: 'past',
  title: 'Прошедшее занятие',
  format: 'GROUP',
  startsAt: start.toISOString(),
  endsAt: new Date(start.valueOf() + 3000000).toISOString(),
  capacity: 8,
  ageFrom: null,
  ageTo: null,
  status: 'OPEN',
  version: 1,
};
async function mock(page: Page, cancelled = false) {
  const item = { ...session, status: cancelled ? 'CANCELLED' : 'OPEN' };
  await page.route('**/api/v1/**', async (route) => {
    const u = new URL(route.request().url());
    const p = u.pathname.split('/api/v1')[1];
    let body: unknown = {};
    if (p === '/auth/me') body = { state: 'FULL', account };
    else if (p === '/auth/csrf')
      body = { headerName: 'X-CSRF-TOKEN', parameterName: '_csrf', token: 'test' };
    else if (p === '/admin/users') body = { items: [account], page: 0, size: 25, total: 1 };
    else if (p === '/admin/payment-requests') body = { items: [], page: 0, size: 25, total: 0 };
    else if (p === '/admin/calendar')
      body = { items: [item], from: u.searchParams.get('from'), to: u.searchParams.get('to') };
    else if (p === '/admin/session-series/calendar')
      body = {
        memberships: [
          {
            sessionId: item.id,
            seriesId: 'series',
            groupId: 'group',
            groupName: 'Группа',
            exception: false,
          },
        ],
        drafts: [],
        warnings: [],
      };
    else if (p === '/admin/schedule-groups') body = { items: [] };
    else if (p === '/admin/sessions/past/draft') body = { session: item, draft: null };
    else if (p === '/admin/sessions/past/history')
      body = {
        items: [{ id: 1, action: 'SESSION_CANCEL', occurredAt: item.startsAt, after: item }],
        page: 0,
        total: 1,
      };
    else if (p === '/sessions') body = { items: [], total: 0, page: 0, size: 25 };
    await route.fulfill({ status: 200, json: body });
  });
}
test('пагинация и оплата: размеры, крестик и мобильный экран', async ({ page }, info) => {
  await mock(page);
  mkdirSync('../artifacts/admin-corrections', { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('admin/users');
  const nav = page.getByRole('navigation', { name: 'Страницы пользователей' });
  const back = nav.getByRole('button', { name: 'Назад' });
  await expect(back).toBeDisabled();
  const a = await back.boundingBox();
  const text = await nav.getByText('Страница 1').boundingBox();
  expect(a!.height).toBeGreaterThanOrEqual(44);
  expect(a!.height).toBeLessThanOrEqual(46);
  expect(Math.abs(a!.y + a!.height / 2 - text!.y - text!.height / 2)).toBeLessThan(1);
  await page.screenshot({
    path: `../artifacts/admin-corrections/${info.project.name}-users-desktop.png`,
  });
  await page.goto('admin/payments');
  const trigger = page.getByRole('button', { name: 'Создать черновик оплаты' });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Черновик оплаты' })).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Закрыть панель' });
  const before = await close.boundingBox();
  const icon = close.locator('span');
  const iconBefore = await icon.boundingBox();
  expect(
    Math.abs(before!.x + before!.width / 2 - iconBefore!.x - iconBefore!.width / 2),
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(before!.y + before!.height / 2 - iconBefore!.y - iconBefore!.height / 2),
  ).toBeLessThanOrEqual(1);
  await close.hover();
  await page.waitForTimeout(250);
  const after = await close.boundingBox();
  const iconAfter = await icon.boundingBox();
  expect(Math.abs(before!.y - after!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(iconBefore!.x - iconAfter!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(iconBefore!.y - iconAfter!.y)).toBeLessThanOrEqual(1);
  await page.mouse.move(0, 0);
  await page.keyboard.press('Tab');
  await close.focus();
  expect(await close.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
  await page.waitForTimeout(250);
  const focusedIcon = await icon.boundingBox();
  expect(Math.abs(iconBefore!.x - focusedIcon!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(iconBefore!.y - focusedIcon!.y)).toBeLessThanOrEqual(1);
  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await page.mouse.down();
  const pressed = await close.boundingBox();
  const pressedIcon = await icon.boundingBox();
  expect(Math.abs(before!.x - pressed!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(before!.y - pressed!.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(iconBefore!.x - pressedIcon!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(iconBefore!.y - pressedIcon!.y)).toBeLessThanOrEqual(1);
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await expect(dialog.getByRole('button', { name: 'Создать платёжную ссылку' })).toBeDisabled();
  await page.screenshot({
    path: `../artifacts/admin-corrections/${info.project.name}-payment-desktop.png`,
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(dialog.getByLabel('Сумма в рублях')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: `../artifacts/admin-corrections/${info.project.name}-payment-mobile.png`,
  });
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 568 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await expect(close).toBeVisible();
  }
  const zoom = await page.addStyleTag({ content: 'html { font-size: 200% }' });
  await expect(close).toBeVisible();
  await dialog.getByLabel('Телефон', { exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByLabel('Телефон', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Сохранить черновик' }).scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: `../artifacts/admin-corrections/${info.project.name}-payment-mobile-200.png`,
  });
  await zoom.evaluate((style) => style.parentNode?.removeChild(style));
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть панель' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('прошедшее занятие редактируется, отменённое показывает параметры', async ({ page }, info) => {
  await mock(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('admin/schedule');
  const event = page.locator('[data-session-id="past"] .calendar-event-body');
  await event.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Изменить занятие' })).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Закрыть панель' });
  const icon = close.locator('span');
  const beforeFocus = await icon.boundingBox();
  await page.keyboard.press('Tab');
  await close.focus();
  expect(await close.evaluate((element) => element.matches(':focus-visible'))).toBe(true);
  await page.waitForTimeout(250);
  const afterFocus = await icon.boundingBox();
  expect(Math.abs(beforeFocus!.x - afterFocus!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(beforeFocus!.y - afterFocus!.y)).toBeLessThanOrEqual(1);
  await expect(dialog.getByLabel('Название', { exact: true })).toHaveValue(session.title);
  await page.screenshot({
    path: `../artifacts/admin-corrections/${info.project.name}-session-desktop.png`,
  });
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 568 });
    await expect(dialog.getByRole('button', { name: 'Закрыть панель' })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
  }
  await page.setViewportSize({ width: 320, height: 568 });
  const zoom = await page.addStyleTag({ content: 'html { font-size: 200% }' });
  await dialog.getByLabel('Название', { exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByLabel('Название', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Сохранить черновик' }).scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: `../artifacts/admin-corrections/${info.project.name}-session-mobile-200.png`,
  });
  await zoom.evaluate((style) => style.parentNode?.removeChild(style));
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    dialog.getByRole('button', { name: 'Это и последующие занятия серии' }),
  ).toBeDisabled();
  await expect(dialog.getByText('Отмена занятия')).toHaveCount(0);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  await dialog.getByLabel('Дата занятия · МСК').fill(tomorrow);
  await dialog.getByRole('button', { name: 'Проверка', exact: true }).click();
  const publish = dialog.getByRole('button', { name: 'Подтвердить публикацию', exact: true });
  await expect(publish).toBeDisabled();
  await expect(publish).toHaveCSS('cursor', 'default');
  await expect(
    dialog.getByText('может измениться доступность занятия для новых заявок', { exact: false }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрыть панель' }).click();
  await dialog.getByRole('button', { name: 'Выйти', exact: true }).click();
});
test('конфликт сохранения сохраняет ввод и позволяет вернуться к проверке', async ({ page }) => {
  await mock(page);
  await page.route('**/api/v1/admin/sessions/past/draft', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { session: { ...session, version: 2 }, draft: null } });
    return route.fulfill({
      status: 409,
      json: { code: 'VERSION_CONFLICT', detail: 'Данные изменились.' },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('admin/schedule');
  await page.locator('[data-session-id="past"] .calendar-event-body').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Название', { exact: true }).fill('Мой несохранённый ввод');
  await dialog.getByRole('button', { name: 'Сохранить черновик' }).click();
  await expect(dialog.getByLabel('Название', { exact: true })).toHaveValue(
    'Мой несохранённый ввод',
  );
  await expect(dialog.getByText('Принять актуальную основу и оставить мой ввод')).toBeVisible();
  await dialog.getByRole('button', { name: 'Проверка', exact: true }).click();
  await expect(dialog.getByText('Мой несохранённый ввод')).toBeVisible();
});
test('отменённое занятие открывается для просмотра', async ({ page }) => {
  await mock(page, true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('admin/schedule');
  await page.locator('[data-session-id="past"] .calendar-event-body').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Просмотр занятия' })).toBeVisible();
  await expect(dialog.getByText('Отменённое занятие доступно только для просмотра.')).toBeVisible();
  await expect(dialog.getByText(session.title)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Проверка' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'История изменений' }).click();
  await expect(dialog.getByText('Занятие отменено', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Восстановить в черновик' })).toHaveCount(0);
});

test('переходы страниц сохраняют правильный номер и граничные состояния', async ({
  page,
}, info) => {
  await mock(page);
  await page.route('**/api/v1/admin/users?**', async (route) => {
    const current = Number(new URL(route.request().url()).searchParams.get('page'));
    await route.fulfill({ json: { items: [account], page: current, size: 25, total: 26 } });
  });
  await page.goto('admin/users');
  const nav = page.getByRole('navigation', { name: 'Страницы пользователей' });
  await expect(nav.getByRole('button', { name: 'Назад' })).toBeDisabled();
  await nav.getByRole('button', { name: 'Далее' }).click();
  await expect(nav.getByText('Страница 2')).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Далее' })).toBeDisabled();
  await nav.getByRole('button', { name: 'Назад' }).focus();
  await page.keyboard.press('Enter');
  await expect(nav.getByText('Страница 1')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addStyleTag({ content: 'html { font-size: 200% }' });
  await nav.scrollIntoViewIfNeeded();
  await expect(nav.getByText('Страница 1')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: `../artifacts/admin-corrections/${info.project.name}-users-mobile-200.png`,
  });
});

test('ошибка сохранения оплаты не стирает введённые поля', async ({ page }) => {
  await mock(page);
  await page.route('**/api/v1/admin/payment-requests', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { items: [], page: 0, size: 25, total: 0 } });
    return route.fulfill({
      status: 409,
      json: {
        code: 'VERSION_CONFLICT',
        detail: 'Данные изменились. Обновите страницу.',
        fieldErrors: {},
      },
    });
  });
  await page.goto('admin/payments');
  await page.getByRole('button', { name: 'Создать черновик оплаты' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Сумма в рублях').fill('1500');
  await dialog.getByLabel('Назначение').fill('Занятие');
  await dialog.getByLabel('Имя получателя').fill('Тестовый родитель');
  await dialog.getByLabel('Телефон', { exact: true }).fill('9001234567');
  await dialog.getByRole('button', { name: 'Сохранить черновик' }).click();
  await expect(dialog.locator('form').getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('Назначение')).toHaveValue('Занятие');
  await expect(dialog.getByLabel('Телефон', { exact: true })).toHaveValue('900 123-45-67');
  await expect(dialog.getByRole('button', { name: 'Создать платёжную ссылку' })).toBeDisabled();
});
