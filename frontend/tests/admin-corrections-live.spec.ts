import { test, expect, request as requestFactory, type APIRequestContext } from '@playwright/test';
const base = 'http://127.0.0.1:18180/lastochka';
async function command(
  r: APIRequestContext,
  path: string,
  data: unknown,
  method: 'post' | 'put' = 'post',
) {
  const csrf = await (await r.get(base + '/api/v1/auth/csrf')).json();
  const response = await r[method](base + '/api/v1' + path, {
    headers: {
      [csrf.headerName]: csrf.token,
      'Idempotency-Key': crypto.randomUUID(),
      Origin: 'http://localhost:18180',
    },
    data,
  });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBe(true);
  return response.json();
}
test('два администратора сохраняют ввод после публикации общего черновика', async ({
  browser,
  request,
}) => {
  const other = await requestFactory.newContext();
  const otherBrowser = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    await command(request, '/auth/password-stage', {
      login: 'fixture-admin',
      password: 'Fixture-pass-123',
    });
    await command(other, '/auth/password-stage', {
      login: 'fixture-admin2',
      password: 'Fixture-pass-123',
    });
    const start = new Date(Date.now() + 86400000 * 1400);
    const params = {
      title: 'Конкурентное занятие',
      format: 'GROUP',
      startsAt: start.toISOString(),
      endsAt: new Date(start.valueOf() + 3600000).toISOString(),
      capacity: 8,
      ageFrom: null,
      ageTo: null,
      replaceAgeRange: true,
    };
    let session = await command(request, '/admin/sessions', params);
    session = await command(request, `/admin/sessions/${session.id}/actions`, {
      expectedVersion: session.version,
      action: 'PUBLISH',
    });
    const saved = await command(
      request,
      `/admin/sessions/${session.id}/draft`,
      {
        expectedSessionVersion: session.version,
        expectedDraftVersion: null,
        session: { ...params, title: 'Общий черновик' },
      },
      'put',
    );
    await otherBrowser.addCookies((await other.storageState()).cookies);
    const page = await otherBrowser.newPage();
    await page.goto(base + '/admin/schedule');
    await page
      .getByLabel('Дата', { exact: true })
      .fill(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(start));
    await page.locator(`[data-session-id="${session.id}"] .calendar-event-body`).click();
    const dialog = page.getByRole('dialog', { name: 'Изменить занятие' });
    await expect(dialog.getByLabel('Название', { exact: true })).toHaveValue('Общий черновик');
    await dialog.getByLabel('Название', { exact: true }).fill('Ввод второго администратора');
    await command(request, `/admin/sessions/${session.id}/draft/publish`, {
      expectedSessionVersion: session.version,
      expectedDraftVersion: saved.draft.version,
    });
    await dialog.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
    await expect(dialog.getByText('Ваш ввод остался в форме.', { exact: false })).toBeVisible();
    await expect(dialog.getByLabel('Название', { exact: true })).toHaveValue(
      'Ввод второго администратора',
    );
    await dialog
      .getByRole('button', { name: 'Принять актуальную основу и оставить мой ввод' })
      .click();
    await dialog.getByRole('button', { name: 'Закрыть панель' }).click();
    const confirm = page.getByRole('dialog', { name: 'Выйти без сохранения?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Остаться' }).click();
    await dialog.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
    await expect(dialog.getByText('Черновик сохранён. На сайте прежние условия.')).toBeVisible();
    const state = await (
      await other.get(base + `/api/v1/admin/sessions/${session.id}/draft`)
    ).json();
    expect(state.session.title).toBe('Общий черновик');
    expect(state.draft.session.title).toBe('Ввод второго администратора');
  } finally {
    await otherBrowser.close();
    await other.dispose();
  }
});
test('реальный редактор исправляет прошлое занятие и сохраняет черновик оплаты', async ({
  page,
  request,
  context,
}) => {
  await command(request, '/auth/password-stage', {
    login: 'fixture-admin',
    password: 'Fixture-pass-123',
  });
  const offsetDays = 10 + Math.floor(Math.random() * 1000);
  const start = new Date(Date.now() + 86400000 * offsetDays);
  const input = {
    title: 'Исходное проверочное занятие',
    format: 'GROUP',
    startsAt: start.toISOString(),
    endsAt: new Date(start.valueOf() + 3600000).toISOString(),
    capacity: 8,
    ageFrom: null,
    ageTo: null,
    replaceAgeRange: true,
  };
  let session = await command(request, '/admin/sessions', input);
  session = await command(request, `/admin/sessions/${session.id}/actions`, {
    expectedVersion: session.version,
    action: 'PUBLISH',
  });
  const enquiry = await command(request, '/enquiries', {
    parentName: 'Тестовый родитель',
    phone: '+79001234567',
    desiredSessionId: session.id,
    desiredSessionVersion: session.version,
  });
  const before = await (await request.get(base + '/api/v1/admin/enquiries')).json();
  const snapshot = before.items.find(
    (item: { number: number }) => item.number === enquiry.number,
  ).desiredSessionSnapshot;
  const past = new Date(Date.now() - 86400000 * offsetDays);
  session = await command(
    request,
    `/admin/sessions/${session.id}`,
    {
      expectedVersion: session.version,
      session: {
        ...input,
        startsAt: past.toISOString(),
        endsAt: new Date(past.valueOf() + 3600000).toISOString(),
      },
    },
    'put',
  );
  await context.addCookies((await request.storageState()).cookies);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + '/admin/schedule');
  const moscowDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(past);
  await page.getByLabel('Дата', { exact: true }).fill(moscowDate);
  await page.locator(`[data-session-id="${session.id}"] .calendar-event-body`).click();
  const dialog = page.getByRole('dialog', { name: 'Изменить занятие' });
  await expect(dialog.getByLabel('Название', { exact: true })).toHaveValue(input.title);
  await dialog.getByLabel('Название', { exact: true }).fill('Исправленное проверочное занятие');
  await dialog.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(dialog.getByText('Черновик сохранён. На сайте прежние условия.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Проверить изменения', exact: true }).click();
  await expect(dialog.getByText('Исходное проверочное занятие')).toBeVisible();
  await expect(dialog.getByText('Исправленное проверочное занятие')).toBeVisible();
  await dialog.getByRole('button', { name: 'Подтвердить публикацию', exact: true }).click();
  await expect(dialog.getByText('Изменения опубликованы.')).toBeVisible();
  const read = await (
    await request.get(base + `/api/v1/admin/sessions/${session.id}/draft`)
  ).json();
  expect(read.session.title).toBe('Исправленное проверочное занятие');
  expect(read.draft).toBeNull();
  const after = await (await request.get(base + '/api/v1/admin/enquiries')).json();
  expect(
    after.items.find((item: { number: number }) => item.number === enquiry.number)
      .desiredSessionSnapshot,
  ).toBe(snapshot);
  await dialog.getByRole('button', { name: 'Закрыть панель' }).click();
  await page.goto(base + '/admin/payments');
  await page.getByRole('button', { name: 'Создать черновик оплаты' }).click();
  const payment = page.getByRole('dialog', { name: 'Черновик оплаты' });
  const paymentTitle = `Проверочная оплата ${crypto.randomUUID().slice(0, 8)}`;
  await payment.getByLabel('Сумма в рублях').fill('1500');
  await payment.getByLabel('Назначение').fill(paymentTitle);
  await payment.getByLabel('Имя получателя').fill('Тестовый родитель');
  await payment.getByLabel('Телефон', { exact: true }).fill('9001234567');
  await payment.getByRole('button', { name: 'Сохранить черновик' }).click();
  await expect(page.getByText('Черновик оплаты сохранён.')).toBeVisible();
  await expect(page.getByText(paymentTitle).first()).toBeVisible();
  await page
    .locator('article')
    .filter({ hasText: paymentTitle })
    .getByRole('button', { name: 'Изменить черновик' })
    .click();
  const editedPayment = page.getByRole('dialog', { name: 'Черновик оплаты' });
  await expect(editedPayment.getByLabel('Сумма в рублях')).toHaveValue('1500.00');
  await editedPayment.getByLabel('Назначение').fill(`Изменено: ${paymentTitle}`);
  await editedPayment.getByRole('button', { name: 'Сохранить черновик' }).click();
  await expect(page.getByText(`Изменено: ${paymentTitle}`).first()).toBeVisible();
  await page.goto(base + '/admin/requests');
  const card = page.locator('article').filter({ hasText: `Заявка №${enquiry.number}` });
  await card.getByRole('button', { name: 'Открыть заявку' }).click();
  await expect(page.getByRole('dialog', { name: `Заявка №${enquiry.number}` })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Открыть заявку' })).toBeFocused();
  await card.getByRole('button', { name: 'Открыть заявку' }).click();
  await page.getByRole('button', { name: 'Подготовить оплату' }).click();
  const fromEnquiry = page.getByRole('dialog', { name: 'Черновик оплаты' });
  await expect(fromEnquiry.getByLabel('Имя получателя')).toHaveValue('Тестовый родитель');
  await expect(fromEnquiry.getByLabel('Телефон', { exact: true })).toHaveValue('900 123-45-67');
  await expect(
    fromEnquiry.getByRole('button', { name: 'Создать платёжную ссылку' }),
  ).toBeDisabled();
  await fromEnquiry.getByLabel('Сумма в рублях').fill('750');
  await fromEnquiry.getByLabel('Назначение').fill('Оплата из заявки');
  await fromEnquiry.getByRole('button', { name: 'Сохранить черновик' }).click();
  await expect(page.getByText('Черновик оплаты сохранён.')).toBeVisible();
  const afterPayment = await (await request.get(base + '/api/v1/admin/enquiries')).json();
  expect(
    afterPayment.items.find((item: { number: number }) => item.number === enquiry.number)
      .desiredSessionSnapshot,
  ).toBe(snapshot);
});

test('прошедшее вхождение серии исправляется отдельно через кабинет', async ({
  page,
  request,
  context,
}) => {
  await command(request, '/auth/password-stage', {
    login: 'fixture-admin',
    password: 'Fixture-pass-123',
  });
  const moscowToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(
    new Date(),
  );
  const d = new Date(moscowToday + 'T12:00:00Z');
  const day = d.getUTCDay() || 7;
  const monday = new Date(d.valueOf() - (day - 1) * 86400000).toISOString().slice(0, 10);
  const nextMonday = new Date(Date.parse(monday + 'T12:00:00Z') + 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  const minute = String(Math.floor(Math.random() * 50)).padStart(2, '0');
  const rule = {
    startDate: monday,
    endDate: nextMonday,
    weekdays: [1],
    startTime: `09:${minute}`,
    durationMinutes: 1,
    title: `Проверочная серия ${crypto.randomUUID().slice(0, 8)}`,
    capacity: 8,
  };
  const draft = await command(request, '/admin/session-series/new-group', { rule });
  const plan = await command(request, `/admin/session-series/${draft.id}/preview`, {
    ...draft.draft,
    expectedVersion: draft.version,
    expectedDraftVersion: draft.draftVersion,
  });
  expect(plan.canPublish).toBe(true);
  await command(request, `/admin/session-series/${draft.id}/publish`, {
    expectedVersion: draft.version,
    expectedDraftVersion: draft.draftVersion,
    digest: plan.digest,
  });
  const query = `?from=${encodeURIComponent(new Date(monday + 'T00:00:00+03:00').toISOString())}&to=${encodeURIComponent(new Date(nextMonday + 'T23:59:59+03:00').toISOString())}`;
  const all = await (await request.get(base + '/api/v1/admin/sessions' + query)).json();
  const items = all.items.filter((item: { title: string }) => item.title === rule.title);
  expect(items).toHaveLength(2);
  const past = items[0];
  const later = items[1];
  await context.addCookies((await request.storageState()).cookies);
  await page.goto(base + '/admin/schedule');
  await page.getByLabel('Дата', { exact: true }).fill(monday);
  await page.getByLabel('Вид').selectOption('list');
  await page
    .locator('article')
    .filter({ hasText: rule.title })
    .getByRole('button', { name: 'Открыть занятие' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Изменить занятие' });
  await expect(
    dialog.getByRole('button', { name: 'Это и последующие занятия серии' }),
  ).toBeDisabled();
  await dialog.getByLabel('Название', { exact: true }).fill('Исправлено одно занятие');
  await dialog.getByRole('button', { name: 'Сохранить черновик', exact: true }).click();
  await expect(dialog.getByText('Черновик сохранён. На сайте прежние условия.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Проверить изменения' }).click();
  await dialog.getByRole('button', { name: 'Подтвердить публикацию' }).click();
  await expect(dialog.getByText('Изменения опубликованы.')).toBeVisible();
  const after = await (await request.get(base + '/api/v1/admin/sessions' + query)).json();
  expect(after.items.find((item: { id: string }) => item.id === past.id).title).toBe(
    'Исправлено одно занятие',
  );
  expect(after.items.find((item: { id: string }) => item.id === later.id)).toEqual(later);
});
