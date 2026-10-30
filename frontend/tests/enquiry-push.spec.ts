import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';

test.beforeEach(() => {
  if (process.env.TEST_DATABASE_CONTAINER !== 'lastochka-push-isolated-test')
    throw new Error('Требуется изолированная база проверки.');
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'lastochka-push-isolated-test',
      'psql',
      '-U',
      'fixture',
      '-d',
      'test',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'DELETE FROM auth_limits',
    ],
    { stdio: 'ignore' },
  );
});

test('simple guest form accepts contacts without child details', async ({ page }) => {
  await page.goto('./enquiry');
  await expect(page.getByLabel('Имя ребёнка')).toHaveCount(0);
  await expect(page.getByLabel('Возраст ребёнка')).toHaveCount(0);
  await page.getByLabel('Имя родителя').fill('Посетитель проверки');
  await page.getByLabel('Телефон', { exact: true }).fill('9001234567');
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});

test('guest can send without JavaScript', async ({ browser }, info) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: info.project.use.viewport,
  });
  const page = await context.newPage();
  await page.goto('http://localhost:18215/lastochka/enquiry');
  await page.getByLabel('Имя родителя').fill('Посетитель без сценариев');
  await page.getByLabel('Телефон', { exact: true }).fill('9001234567');
  await page.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();
  await context.close();
});

test('opening and clearing the optional schedule keeps contacts, including no JavaScript', async ({
  browser,
}, info) => {
  for (const javaScriptEnabled of [true, false]) {
    const context = await browser.newContext({
      javaScriptEnabled,
      viewport: info.project.use.viewport,
      locale: info.project.use.locale,
    });
    const page = await context.newPage();
    await page.goto('http://localhost:18215/lastochka/enquiry');
    await page.getByLabel('Имя родителя').fill('Контакт проверки');
    await page.getByLabel('Телефон', { exact: true }).fill('9001234567');
    await page.getByRole('button', { name: 'Выбрать занятие', exact: true }).click();
    await expect(page.getByLabel('Имя родителя')).toHaveValue('Контакт проверки');
    await page.getByRole('button', { name: 'Помогите подобрать время', exact: true }).click();
    await expect(page.getByLabel('Имя родителя')).toHaveValue('Контакт проверки');
    await expect(page.getByLabel('Телефон', { exact: true })).not.toHaveValue('');
    await context.close();
  }
});

test('changed selected session preserves contacts and permits a general enquiry', async ({
  browser,
  request,
}, info) => {
  const root = 'http://localhost:18215/lastochka';
  const initialCsrf = await (await request.get(`${root}/api/v1/auth/csrf`)).json();
  const login = await request.post(`${root}/api/v1/auth/password-stage`, {
    headers: { [initialCsrf.headerName]: initialCsrf.token },
    data: { login: 'fixtureadmin', password: 'Fixture-pass-123' },
  });
  expect(login.ok()).toBe(true);
  const csrf = await (await request.get(`${root}/api/v1/auth/csrf`)).json();
  const command = async (path: string, body: unknown) => {
    const response = await request.post(`${root}${path}`, {
      headers: {
        [csrf.headerName]: csrf.token,
        'Idempotency-Key': randomUUID(),
        Origin: 'http://localhost:18215',
      },
      data: body,
    });
    expect(response.ok(), `command ${path}: ${response.status()}`).toBe(true);
    return response.json();
  };
  for (const javaScriptEnabled of [true, false]) {
    let start = new Date();
    let free = false;
    for (let attempt = 0; attempt < 30 && !free; attempt++) {
      start = new Date(Date.now() + randomInt(1000, 20000) * 86400000);
      start.setUTCHours(9, 0, 0, 0);
      const availability = await request.get(`${root}/api/v1/admin/sessions`, {
        params: {
          from: start.toISOString(),
          to: new Date(start.valueOf() + 14400000).toISOString(),
          page: 0,
          size: 1,
        },
      });
      expect(availability.ok()).toBe(true);
      free = (await availability.json()).total === 0;
    }
    expect(free).toBe(true);
    const draft = await command('/api/v1/admin/sessions', {
      title: 'Проверка выбора',
      format: 'GROUP',
      startsAt: start.toISOString(),
      endsAt: new Date(start.valueOf() + 3600000).toISOString(),
      capacity: 6,
    });
    await command(`/api/v1/admin/sessions/${draft.id}/actions`, {
      expectedVersion: draft.version,
      action: 'PUBLISH',
    });
    const later = new Date(start.valueOf() + 7200000);
    const replacement = await command('/api/v1/admin/sessions', {
      title: 'Другое занятие',
      format: 'GROUP',
      startsAt: later.toISOString(),
      endsAt: new Date(later.valueOf() + 3600000).toISOString(),
      capacity: 6,
    });
    const replacementPublished = await command(`/api/v1/admin/sessions/${replacement.id}/actions`, {
      expectedVersion: replacement.version,
      action: 'PUBLISH',
    });
    const context = await browser.newContext({
      javaScriptEnabled,
      viewport: info.project.use.viewport,
      locale: info.project.use.locale,
    });
    const page = await context.newPage();
    await page.goto(`${root}/enquiry?session=${draft.id}`);
    await expect(page.getByLabel('Желаемое занятие')).toContainText('Проверка выбора');
    await page.getByLabel('Имя родителя').fill('Сохранённый контакт');
    await page.getByLabel('Телефон', { exact: true }).fill('9001234567');
    await page.getByRole('button', { name: 'Изменить', exact: true }).click();
    await page.getByLabel('Показать с').fill(later.toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Показать занятия', exact: true }).click();
    await page
      .locator('article')
      .filter({ hasText: 'Другое занятие' })
      .getByRole('button', { name: 'Выбрать это занятие' })
      .click();
    await expect(page.getByLabel('Желаемое занятие')).toContainText('Другое занятие');
    await expect(page.getByLabel('Имя родителя')).toHaveValue('Сохранённый контакт');
    await command(`/api/v1/admin/sessions/${replacement.id}/actions`, {
      expectedVersion: replacementPublished.version,
      action: 'CLOSE',
    });
    await page.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
    await expect(
      page.getByText('Выберите другое занятие или оставьте общую заявку.'),
    ).toBeVisible();
    await expect(page.getByLabel('Имя родителя')).toHaveValue('Сохранённый контакт');
    await page.getByRole('button', { name: 'Помогите подобрать время', exact: true }).click();
    await expect(page.getByLabel('Имя родителя')).toHaveValue('Сохранённый контакт');
    await page.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Заявка принята' })).toBeVisible();
    await context.close();
  }
});

test('administrator can change notification channels', async ({ page }) => {
  await page.goto('./auth/login');
  await page.getByLabel('Логин', { exact: true }).fill('fixtureadmin');
  await page.getByLabel('Пароль', { exact: true }).fill('Fixture-pass-123');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('link', { name: 'Заявки', exact: true }).click();
  const settings = page.getByRole('region', { name: 'Уведомления о заявках' });
  await settings.getByText('Уведомления о заявках', { exact: true }).click();
  await expect(settings.getByLabel('Telegram')).toBeChecked();
  await settings.getByLabel('Уведомления браузера').check();
  await settings.getByRole('button', { name: 'Сохранить каналы' }).click();
  await expect(settings.getByText('Настройки уведомлений сохранены.')).toBeVisible();
  await page.reload();
  await settings.getByText('Уведомления о заявках', { exact: true }).click();
  await expect(settings.getByLabel('Уведомления браузера')).toBeChecked();
  await expect(
    settings.getByText('Бот пока не настроен; заявки сохраняются в кабинете.'),
  ).toBeVisible();
});

test('guest fields remain visible and focusable at narrow widths and larger text', async ({
  page,
}, info) => {
  await page.goto('./enquiry');
  for (const width of [320, 375, 390, 430, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const scale of [100, 200]) {
      await page.evaluate((value) => {
        document.documentElement.style.fontSize = '100%';
        document.querySelectorAll('.enquiry-form label').forEach((label) => {
          (label as HTMLElement).style.fontSize = `${value}%`;
        });
      }, scale);
      for (const name of ['Имя родителя', 'Телефон', 'Комментарий — необязательно']) {
        const field = page.getByLabel(name, { exact: true });
        await field.focus();
        await expect(field).toBeFocused();
        await expect(field).toBeVisible();
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `${info.project.name}, ${width}px, ${scale}%`,
      ).toBe(true);
    }
  }
  await page.setViewportSize({ width: info.project.use.viewport?.width ?? 375, height: 900 });
  const tab = info.project.use.browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await page.getByLabel('Имя родителя', { exact: true }).focus();
  await page.keyboard.press(tab);
  await expect(page.getByLabel('Телефон', { exact: true })).toBeFocused();
  await page.keyboard.press(tab);
  await expect(page.getByRole('button', { name: 'Выбрать занятие', exact: true })).toBeFocused();
  await page.keyboard.press(tab);
  await expect(page.getByLabel('Комментарий — необязательно', { exact: true })).toBeFocused();
});

test('permission refusal leaves enquiries usable and gives a clear status', async ({
  browser,
}, info) => {
  test.skip(
    info.project.use.browserName !== 'chromium',
    'Браузер в этом окружении не предоставляет Push API.',
  );
  const context = await browser.newContext({
    permissions: [],
    viewport: info.project.use.viewport,
    locale: info.project.use.locale,
  });
  const page = await context.newPage();
  await page.goto('http://localhost:18215/lastochka/auth/login');
  await page.getByLabel('Логин', { exact: true }).fill('fixtureadmin');
  await page.getByLabel('Пароль', { exact: true }).fill('Fixture-pass-123');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByRole('link', { name: 'Заявки', exact: true }).click();
  const settings = page.getByRole('region', { name: 'Уведомления о заявках' });
  await settings.getByText('Уведомления о заявках', { exact: true }).click();
  await expect(settings.getByText('Разрешите уведомления в настройках браузера.')).toBeVisible();
  await settings.getByRole('button', { name: 'Подключить это устройство' }).click();
  await expect(settings.getByRole('alert')).toContainText('Разрешение на уведомления не выдано.');
  await expect(page.getByRole('button', { name: 'Открыть заявку' }).first()).toBeVisible();
  await context.close();
});

test('administrator sees old and simplified enquiries without inventing child details', async ({
  page,
  request,
}, info) => {
  const root = 'http://localhost:18215/lastochka';
  const initial = await (await request.get(`${root}/api/v1/auth/csrf`)).json();
  const login = await request.post(`${root}/api/v1/auth/password-stage`, {
    headers: { [initial.headerName]: initial.token },
    data: { login: 'fixtureadmin', password: 'Fixture-pass-123' },
  });
  expect(login.ok()).toBe(true);
  const csrf = await (await request.get(`${root}/api/v1/auth/csrf`)).json();
  const settings = await (
    await request.get(`${root}/api/v1/admin/enquiry-notification-settings`)
  ).json();
  const saveSettings = async (value: Record<string, unknown>) =>
    request.put(`${root}/api/v1/admin/enquiry-notification-settings`, {
      headers: { [csrf.headerName]: csrf.token },
      data: value,
    });
  try {
    expect(
      (await saveSettings({ ...settings, telegramEnabled: false, browserPushEnabled: false })).ok(),
    ).toBe(true);
    const submit = async (body: Record<string, unknown>) => {
      const result = await request.post(`${root}/api/v1/enquiries`, {
        headers: {
          [csrf.headerName]: csrf.token,
          'Idempotency-Key': randomUUID(),
          Origin: 'http://localhost:18215',
        },
        data: body,
      });
      expect(result.ok()).toBe(true);
      return result.json();
    };
    const old = await submit({
      parentName: 'Прежняя заявка',
      phone: '+79001234567',
      childName: 'Ребёнок',
      childAge: 7,
    });
    const modern = await submit({ parentName: 'Новая заявка', phone: '+79001234567' });
    await page.context().addCookies((await request.storageState()).cookies);
    await page.goto(`${root}/admin/requests`);
    const open = async (number: number) => {
      await page
        .locator('article')
        .filter({ has: page.getByRole('heading', { name: `Заявка №${number}`, exact: true }) })
        .getByRole('button', { name: 'Открыть заявку' })
        .click();
      return page.getByRole('dialog');
    };
    let panel = await open(old.number);
    await expect(panel).toContainText('Ребёнок, возраст: 7');
    await panel.getByRole('button', { name: 'Закрыть панель' }).click();
    panel = await open(modern.number);
    await expect(panel).toContainText('Новая заявка');
    await expect(panel).not.toContainText('возраст:');
    await expect(panel).toContainText('Канал не был выбран');
    for (const width of [320, 375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => {
        for (const element of document.querySelectorAll(
          '.workspace-panel p, .workspace-panel button',
        ))
          (element as HTMLElement).style.fontSize = '200%';
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        `${info.project.name} ${width}px`,
      ).toBe(true);
      await expect(panel.getByRole('button', { name: 'Закрыть панель' })).toBeVisible();
    }
  } finally {
    const current = await (
      await request.get(`${root}/api/v1/admin/enquiry-notification-settings`)
    ).json();
    await saveSettings({
      ...current,
      telegramEnabled: settings.telegramEnabled,
      browserPushEnabled: settings.browserPushEnabled,
    });
  }
});
