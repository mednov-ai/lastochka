import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const directionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('создание двух дней показывает план, сохраняет ввод при конфликте и публикует один запрос', async ({ page }, info) => {
  let captured: any, conflict = true, published = 0;
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.split('/api/v1')[1];
    let body: unknown = {};
    if (path === '/auth/me') body = { state: 'FULL', account: { id: 'admin', login: 'admin', name: 'Администратор', role: 'ADMIN', roles: ['ADMIN'] } };
    else if (path === '/auth/csrf') body = { token: 'fixture', headerName: 'X-CSRF-TOKEN', parameterName: '_csrf' };
    else if (path === '/public/age-directions') body = { items: [{ id: directionId, title: '8–9 лет', description: '', ageFrom: 8, ageTo: 9, ageOpenEnded: false, active: true, sortOrder: 30, version: 0 }] };
    else if (path === '/admin/calendar') body = { items: [], from: '', to: '' };
    else if (path === '/admin/schedule-groups') body = { items: [] };
    else if (path === '/admin/session-series/calendar') body = { memberships: [], drafts: [], warnings: [] };
    else if (path === '/admin/permanent-schedule/preview') {
      captured = route.request().postDataJSON();
      body = { directionTitle: '8–9 лет', digest: 'fixture-plan', samples: [
        [{ date: '2080-01-01', startsAt: '2080-01-01T14:00:00Z', endsAt: '2080-01-01T15:00:00Z' }],
        [{ date: '2080-01-06', startsAt: '2080-01-06T08:00:00Z', endsAt: '2080-01-06T09:00:00Z' }],
      ], conflicts: conflict ? [{ slot: 1, source: 'RULE', date: '2080-01-06' }] : [], hasPendingDrafts: false, canPublish: !conflict };
    } else if (path === '/admin/permanent-schedule/publish') { published++; body = { seriesIds: [directionId] }; }
    await route.fulfill({ json: body });
  });
  await page.goto('/admin/schedule');
  await page.getByRole('button', { name: 'Создать расписание' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Возрастное направление')).toHaveValue(directionId);
  await expect(dialog.getByLabel('Размер группы')).toHaveCount(0);
  if (info.project.name === 'desktop') {
    await dialog.getByLabel('Возрастное направление').focus();
    await page.keyboard.press('Tab');
    await expect(dialog.getByLabel('Начать с даты')).toBeFocused();
    for (let i = 0; i < 6 && !(await dialog.getByLabel('День недели').first().evaluate((element) => element === document.activeElement)); i++)
      await page.keyboard.press('Tab');
    await expect(dialog.getByLabel('День недели').first()).toBeFocused();
  }
  await dialog.getByLabel('Начать с даты').fill('2080-01-01');
  const firstSlot = dialog.getByRole('group', { name: 'Занятие 1' });
  await firstSlot.getByRole('button', { name: 'Увеличить на 30 минут' }).click();
  await expect(firstSlot.getByLabel('Длительность, минут')).toHaveValue('90');
  await firstSlot.getByLabel('Длительность, минут').press('ArrowDown');
  await expect(firstSlot.getByLabel('Длительность, минут')).toHaveValue('60');
  await firstSlot.getByLabel('Длительность, минут').fill('53');
  await firstSlot.getByLabel('Длительность, минут').press('ArrowUp');
  await expect(firstSlot.getByLabel('Длительность, минут')).toHaveValue('83');
  await firstSlot.getByLabel('Длительность, минут').fill('60');
  await dialog.getByRole('button', { name: 'Добавить день и время' }).click();
  const second = dialog.getByRole('group', { name: 'Занятие 2' });
  await second.getByLabel('День недели').selectOption('6');
  await second.getByLabel('Начало, МСК').fill('11:00');
  await dialog.getByRole('button', { name: 'Проверить расписание' }).click();
  await expect(dialog.getByRole('heading', { name: /Проверка расписания/ })).toBeVisible();
  await expect(dialog.getByText(/Конфликт:/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Опубликовать расписание' })).toBeDisabled();
  expect(captured.slots).toEqual([{ weekday: 1, time: '17:00', durationMinutes: 60 }, { weekday: 6, time: '11:00', durationMinutes: 60 }]);
  expect(captured.capacity).toBe(8);
  mkdirSync('../artifacts/permanent-schedule', { recursive: true });
  await page.screenshot({ path: `../artifacts/permanent-schedule/${info.project.name}-admin-conflict.png`, fullPage: true });
  if (info.project.name === 'mobile') {
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: '../artifacts/permanent-schedule/mobile-admin-200-percent.png', fullPage: true });
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  }
  conflict = false;
  await second.getByLabel('Начало, МСК').fill('12:00');
  await expect(dialog.getByLabel('Начать с даты')).toHaveValue('2080-01-01');
  await expect(second.getByLabel('День недели')).toHaveValue('6');
  await dialog.getByRole('button', { name: 'Проверить расписание' }).click();
  await dialog.getByRole('button', { name: 'Опубликовать расписание' }).click();
  await expect.poll(() => published).toBe(1);
  await expect(dialog).toHaveCount(0);
});

test('расчётную дату можно открыть и отменить через существующий редактор', async ({ page }) => {
  const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  let created = false, cancelled = false;
  const current = () => ({ id, title: '8–9 лет', format: 'GROUP', startsAt: '2080-01-01T14:00:00Z', endsAt: '2080-01-01T15:00:00Z', capacity: 8, ageFrom: 8, ageTo: 9, ageOpenEnded: false, status: cancelled ? 'CANCELLED' : 'OPEN', version: cancelled ? 2 : 1, zone: 'Europe/Moscow' });
  await page.route('**/api/v1/**', async (route) => {
    const u = new URL(route.request().url()), path = u.pathname.split('/api/v1')[1];
    let body: unknown = {};
    if (path === '/auth/me') body = { state: 'FULL', account: { id: 'admin', login: 'admin', name: 'Администратор', role: 'ADMIN', roles: ['ADMIN'] } };
    else if (path === '/auth/csrf') body = { token: 'fixture', headerName: 'X-CSRF-TOKEN', parameterName: '_csrf' };
    else if (path === '/admin/calendar') body = { items: created ? [current()] : [], from: u.searchParams.get('from'), to: u.searchParams.get('to') };
    else if (path === '/admin/schedule-groups') body = { items: [] };
    else if (path === '/admin/session-series/calendar') body = { memberships: created ? [{ sessionId: id, seriesId: directionId, groupId: directionId, groupName: '8–9 лет', originalDate: '2080-01-01', exception: false, permanent: true }] : [], drafts: [], warnings: [] };
    else if (path === '/public/schedule') {
      const inRange = (u.searchParams.get('from') || '') <= '2080-01-01T14:00:00Z' && (u.searchParams.get('to') || '') > '2080-01-01T14:00:00Z';
      const items = inRange && !created ? [{ kind: 'CALCULATED', calculated: { seriesId: directionId, originalDate: '2080-01-01', seriesVersion: 1, title: '8–9 лет', startsAt: '2080-01-01T14:00:00Z', endsAt: '2080-01-01T15:00:00Z', capacity: 8, ageFrom: 8, ageTo: 9, ageOpenEnded: false } }] : [];
      body = { items, page: Number(u.searchParams.get('page')), size: Number(u.searchParams.get('size')), total: items.length, containsCalculated: items.length > 0 };
    } else if (path === '/admin/permanent-schedule/occurrence') { created = true; body = current(); }
    else if (path === `/admin/sessions/${id}/draft`) body = { session: current(), draft: null };
    else if (path === `/admin/sessions/${id}/actions`) { cancelled = route.request().postDataJSON().action === 'CANCEL'; body = current(); }
    await route.fulfill({ json: body });
  });
  await page.goto('/admin/schedule');
  await page.getByLabel('Дата', { exact: true }).fill('2080-01-01');
  await page.getByRole('button', { name: 'Изменить или отменить' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Изменить занятие' })).toBeVisible();
  await expect(dialog.getByText('Постоянное расписание', { exact: true })).toBeVisible();
  await dialog.getByText('Отмена занятия', { exact: true }).click();
  await dialog.getByLabel('Причина отмены').fill('Тестовая отмена');
  await dialog.getByRole('button', { name: 'Подтвердить отмену занятия' }).click();
  await expect.poll(() => cancelled).toBe(true);
});

test('изменение постоянного времени сохраняет прежний размер и показывает затрагиваемые даты', async ({ page }) => {
  let changed: any, previewed: any;
  const rule = { seriesId: directionId, version: 4, directionId, title: '8–9 лет', startDate: '2080-01-01', weekday: 1, time: '17:00:00', durationMinutes: 60, capacity: 13 };
  const session = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: '8–9 лет', format: 'GROUP', startsAt: '2080-02-05T14:00:00Z', endsAt: '2080-02-05T15:00:00Z', capacity: 13, ageFrom: 8, ageTo: 9, ageOpenEnded: false, status: 'OPEN', version: 1, zone: 'Europe/Moscow' };
  await page.route('**/api/v1/**', async (route) => {
    const u = new URL(route.request().url()), path = u.pathname.split('/api/v1')[1];
    let body: unknown = {};
    if (path === '/auth/me') body = { state: 'FULL', account: { id: 'admin', login: 'admin', name: 'Администратор', role: 'ADMIN', roles: ['ADMIN'] } };
    else if (path === '/auth/csrf') body = { token: 'fixture', headerName: 'X-CSRF-TOKEN', parameterName: '_csrf' };
    else if (path === '/public/age-directions') body = { items: [{ id: directionId, title: '8–9 лет', description: '', ageFrom: 8, ageTo: 9, ageOpenEnded: false, active: true, sortOrder: 30, version: 0 }] };
    else if (path === '/admin/calendar') body = { items: [], from: u.searchParams.get('from'), to: u.searchParams.get('to') };
    else if (path === '/admin/schedule-groups') body = { items: [] };
    else if (path === '/admin/session-series/calendar') body = { memberships: [], drafts: [], warnings: [] };
    else if (path === '/admin/permanent-schedule' && route.request().method() === 'GET') body = { items: [rule] };
    else if (path === '/public/schedule') body = { items: [], page: 0, size: 100, total: 0, containsCalculated: false };
    else if (path === '/admin/permanent-schedule/change/preview') { previewed = route.request().postDataJSON(); body = { directionTitle: '8–9 лет', digest: 'change-plan', samples: [[{ date: '2080-02-05', startsAt: '2080-02-05T15:00:00Z', endsAt: '2080-02-05T16:00:00Z' }]], conflicts: [], hasPendingDrafts: false, canPublish: true, affected: [{ session, originalDate: '2080-02-05', action: 'CHANGE' }] }; }
    else if (path === '/admin/permanent-schedule/change') { changed = route.request().postDataJSON(); body = { seriesId: directionId, version: 5 }; }
    await route.fulfill({ json: body });
  });
  await page.goto('/admin/schedule');
  await page.getByRole('button', { name: 'Постоянное расписание', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Изменить расписание' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Возрастное направление')).toHaveValue(directionId);
  await expect(dialog.getByLabel('Размер группы')).toHaveCount(0);
  await dialog.getByLabel('Изменить с даты').fill('2080-02-01');
  await dialog.getByLabel('Начало, МСК').fill('18:00');
  await dialog.getByRole('button', { name: 'Проверить расписание' }).click();
  await expect(dialog.getByRole('heading', { name: 'Изменятся существующие занятия' })).toBeVisible();
  await expect(dialog.getByText(/будут обновлены условия и время/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Применить изменения' }).click();
  await expect.poll(() => changed?.change?.expectedVersion).toBe(4);
  expect(changed.change.plan.slots[0].time).toBe('18:00');
  expect(previewed.plan.capacity).toBe(13);
  expect(changed.change.plan.capacity).toBe(13);
});

test('остановка показывает конкретные отмены до подтверждения', async ({ page }) => {
  let stopped: any;
  const rule = { seriesId: directionId, version: 4, directionId, title: '8–9 лет', startDate: '2080-01-01', weekday: 1, time: '17:00:00', durationMinutes: 60, capacity: 8 };
  const session = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: '8–9 лет', format: 'GROUP', startsAt: '2080-02-05T14:00:00Z', endsAt: '2080-02-05T15:00:00Z', capacity: 8, ageFrom: 8, ageTo: 9, ageOpenEnded: false, status: 'OPEN', version: 1, zone: 'Europe/Moscow' };
  await page.route('**/api/v1/**', async (route) => {
    const u = new URL(route.request().url()), path = u.pathname.split('/api/v1')[1];
    let body: unknown = {};
    if (path === '/auth/me') body = { state: 'FULL', account: { id: 'admin', login: 'admin', name: 'Администратор', role: 'ADMIN', roles: ['ADMIN'] } };
    else if (path === '/auth/csrf') body = { token: 'fixture', headerName: 'X-CSRF-TOKEN', parameterName: '_csrf' };
    else if (path === '/public/age-directions') body = { items: [{ id: directionId, title: '8–9 лет', description: '', ageFrom: 8, ageTo: 9, ageOpenEnded: false, active: true, sortOrder: 30, version: 0 }] };
    else if (path === '/admin/calendar') body = { items: [], from: u.searchParams.get('from'), to: u.searchParams.get('to') };
    else if (path === '/admin/schedule-groups') body = { items: [] };
    else if (path === '/admin/session-series/calendar') body = { memberships: [], drafts: [], warnings: [] };
    else if (path === '/admin/permanent-schedule' && route.request().method() === 'GET') body = { items: [rule] };
    else if (path === '/public/schedule') body = { items: [], page: 0, size: 100, total: 0, containsCalculated: false };
    else if (path === '/admin/permanent-schedule/stop/preview') body = { digest: 'stop-plan', hasPendingDrafts: false, canPublish: true, affected: [{ session, originalDate: '2080-02-05', action: 'CANCEL' }] };
    else if (path === '/admin/permanent-schedule/stop') { stopped = route.request().postDataJSON(); body = { seriesId: directionId, version: 5 }; }
    await route.fulfill({ json: body });
  });
  await page.goto('/admin/schedule');
  await page.getByRole('button', { name: 'Постоянное расписание', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Изменить расписание' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Остановить еженедельное расписание', { exact: true }).click();
  await dialog.getByLabel('Остановить с даты').fill('2080-02-01');
  await dialog.getByRole('button', { name: 'Проверить остановку' }).click();
  await expect(dialog.getByRole('region', { name: 'Проверка остановки' })).toContainText('занятие будет отменено');
  await dialog.getByRole('button', { name: 'Подтвердить остановку расписания' }).click();
  await expect.poll(() => stopped?.stop?.boundary).toBe('2080-02-01');
  expect(stopped.stop.expectedVersion).toBe(4);
});

test('разовое групповое занятие берёт название и возраст из справочника', async ({ page }) => {
  let saved: any;
  await page.route('**/api/v1/**', async (route) => {
    const u = new URL(route.request().url()), path = u.pathname.split('/api/v1')[1];
    let body: unknown = {};
    if (path === '/auth/me') body = { state: 'FULL', account: { id: 'admin', login: 'admin', name: 'Администратор', role: 'ADMIN', roles: ['ADMIN'] } };
    else if (path === '/auth/csrf') body = { token: 'fixture', headerName: 'X-CSRF-TOKEN', parameterName: '_csrf' };
    else if (path === '/public/age-directions') body = { items: [{ id: directionId, title: '14+ лет', description: '', ageFrom: 14, ageTo: null, ageOpenEnded: true, active: true, sortOrder: 30, version: 3 }] };
    else if (path === '/admin/calendar') body = { items: [], from: u.searchParams.get('from'), to: u.searchParams.get('to') };
    else if (path === '/admin/schedule-groups') body = { items: [] };
    else if (path === '/admin/session-series/calendar') body = { memberships: [], drafts: [], warnings: [] };
    else if (path === '/public/schedule') body = { items: [], page: 0, size: 100, total: 0, containsCalculated: false };
    else if (path === '/admin/sessions' && route.request().method() === 'POST') {
      saved = route.request().postDataJSON();
      body = { ...saved, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'DRAFT', version: 0, zone: 'Europe/Moscow' };
    }
    await route.fulfill({ json: body });
  });
  await page.goto('/admin/schedule');
  await page.getByRole('button', { name: 'Создать занятие', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Возрастное направление')).toHaveValue(directionId);
  await expect(dialog.getByLabel('Название', { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('Размер группы')).toHaveValue('8');
  await dialog.getByLabel('Формат').selectOption('INDIVIDUAL');
  await expect(dialog.getByLabel('Название', { exact: true })).toBeVisible();
  await dialog.getByLabel('Формат').selectOption('GROUP');
  await expect(dialog.getByLabel('Размер группы')).toHaveValue('8');
  await dialog.getByLabel('Дата занятия · МСК').fill('2080-01-01');
  await dialog.getByRole('button', { name: 'Сохранить черновик' }).click();
  await expect.poll(() => saved?.ageDirectionId).toBe(directionId);
  expect(saved.ageDirectionVersion).toBe(3);
  expect(saved.title).toBe('14+ лет');
  expect(saved.ageFrom).toBe(14);
  expect(saved.ageOpenEnded).toBe(true);
});
