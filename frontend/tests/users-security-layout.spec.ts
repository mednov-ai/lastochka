import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const account = {
  id: 'self',
  login: 'admin1',
  name: 'Администратор 1',
  role: 'ADMIN',
  roles: ['ADMIN'],
};
const users = [
  { ...account, revision: 1, mustChangePassword: false, expiresAt: null },
  {
    id: 'other',
    login: 'admin2',
    name: 'Администратор 2',
    role: 'ADMIN',
    revision: 1,
    mustChangePassword: true,
    expiresAt: '2099-01-01T00:00:00Z',
  },
  {
    id: 'expired',
    login: 'doctor1',
    name: 'Врач / администратор',
    role: 'ADMIN',
    revision: 1,
    mustChangePassword: true,
    expiresAt: '2020-01-01T00:00:00Z',
  },
];
const key = (id: string) => ({
  id,
  label: `Ключ ${id}`,
  createdAt: '2026-01-01T00:00:00Z',
  lastUsedAt: '2026-01-01T00:00:00Z',
});

async function mock(
  page: Page,
  opts: { keys?: number; restricted?: boolean; long?: boolean } = {},
) {
  let keys = Array.from({ length: opts.keys ?? 0 }, (_, i) => key(String(i + 1)));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.split('/api/v1')[1];
    const method = request.method();
    let body: unknown = {};
    if (path === '/auth/me')
      body = { state: opts.restricted ? 'PASSWORD_CHANGE_REQUIRED' : 'FULL', account };
    else if (path === '/auth/csrf')
      body = { headerName: 'X-CSRF-TOKEN', parameterName: '_csrf', token: 'test' };
    else if (path === '/admin/users' && method === 'GET') {
      const items = opts.long
        ? [
            ...users,
            {
              ...users[1],
              id: 'long',
              name: 'Очень длинное имя '.repeat(7),
              login: 'long-'.repeat(12),
            },
          ]
        : users;
      body = { items, page: 0, size: 25, total: items.length };
    } else if (
      path === '/admin/enquiries' ||
      path === '/admin/payment-requests' ||
      path === '/sessions'
    ) {
      body = { items: [], page: 0, size: 25, total: 0 };
    } else if (path === '/auth/webauthn/credentials' && method === 'GET') body = keys;
    else if (path.startsWith('/auth/webauthn/credentials/') && method === 'PATCH') {
      const id = path.split('/').pop();
      keys = keys.map((item) =>
        item.id === id ? { ...item, label: request.postDataJSON().label } : item,
      );
    } else if (path.startsWith('/auth/webauthn/credentials/') && method === 'DELETE') {
      keys = keys.filter((item) => item.id !== path.split('/').pop());
    } else if (path === '/auth/change-password') {
      return route.fulfill({
        status: 400,
        json: {
          code: 'INVALID_PASSWORD',
          requestId: 'fixture',
          detail: 'Проверьте текущий пароль.',
          fieldErrors: { currentPassword: 'Неверный текущий пароль.' },
        },
      });
    }
    await route.fulfill({ status: 200, json: body });
  });
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
}

test('компактные записи и адаптивная безопасность', async ({ page }, info) => {
  await mock(page, { keys: 2, long: true });
  mkdirSync('../artifacts/users-security', { recursive: true });
  await page.goto('admin/users');
  await expect(page.locator('.user-row')).toHaveCount(4);
  for (const width of [320, 375, 430, 768, 1000, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
    if (width >= 1280) {
      for (const row of await page.locator('.user-row').all()) {
        const box = await row.boundingBox();
        if (!(await row.innerText()).includes('Очень длинное'))
          expect(box!.height).toBeLessThanOrEqual(96);
      }
    }
    if ([320, 1440].includes(width))
      await page.screenshot({
        path: `../artifacts/users-security/${info.project.name}-users-${width}.png`,
        fullPage: true,
      });
  }
  const usersZoom = await page.addStyleTag({ content: 'html { font-size: 200% }' });
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
  }
  await usersZoom.evaluate((style) => style.parentNode?.removeChild(style));
  await expect(page.getByText('Временный пароль истёк')).toBeVisible();
  await expect(page.getByText('Пароль нужно сменить').first()).toBeVisible();
  await expect(
    page.locator('.user-row').first().getByText('Ваш аккаунт', { exact: false }),
  ).toBeVisible();
  await page.goto('account/security');
  await expect(page.getByRole('heading', { name: 'Ключи доступа' })).toBeVisible();
  await expect(page.getByText('Вернуться к расписанию')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Сайт · Расписание' })).toBeVisible();
  for (const width of [320, 375, 430, 768, 1000, 1280, 1440]) {
    await page.setViewportSize({ width, height: 650 });
    await noOverflow(page);
    const boxes = await page.locator('.security-layout > .form-card').all();
    const first = await boxes[0].boundingBox();
    const second = await boxes[1].boundingBox();
    if (width >= 1280) expect(Math.abs(first!.y - second!.y)).toBeLessThan(2);
    if (width <= 430) expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1);
    for (const button of await page.locator('.security-layout button:visible').all())
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if ([320, 1440].includes(width))
      await page.screenshot({
        path: `../artifacts/users-security/${info.project.name}-security-${width}.png`,
        fullPage: true,
      });
  }
  await page.addStyleTag({ content: 'html { font-size: 200% }' });
  for (const width of [320, 375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await noOverflow(page);
  }
  await expect(page.getByRole('button', { name: 'Проверить ключ доступа' })).toBeVisible();
  await page.getByLabel('Название', { exact: true }).first().fill('Мой ключ');
  await page.getByRole('button', { name: 'Сохранить название' }).first().click();
  await expect(page.getByLabel('Название', { exact: true }).first()).toHaveValue('Мой ключ');
  await page.getByRole('button', { name: 'Отозвать' }).last().click();
  await expect(page.getByRole('button', { name: 'Отозвать' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Отозвать' })).toBeDisabled();
});

test('формы пользователя и пароля сохраняют поведение', async ({ page }) => {
  await mock(page);
  await page.goto('admin/users');
  await page.getByRole('button', { name: 'Добавить пользователя' }).click();
  await expect(page.getByRole('heading', { name: 'Новый администратор' })).toBeVisible();
  await page.getByRole('button', { name: 'Отмена' }).click();
  await page
    .locator('.user-row')
    .nth(1)
    .getByRole('button', { name: 'Назначить временный пароль' })
    .click();
  await expect(page.getByRole('checkbox')).toBeVisible();
  await page.getByRole('button', { name: 'Отмена' }).click();
  await page.goto('account/security');
  await expect(page.getByRole('link', { name: 'Подтвердить пароль заново' })).toBeVisible();
  await page.getByLabel('Текущий пароль', { exact: true }).fill('Oldpass1');
  await page.getByLabel('Новый пароль', { exact: true }).fill('Newpass1');
  await page.getByLabel('Повторите новый пароль', { exact: true }).fill('Newpass1');
  await page.getByRole('button', { name: 'Показать пароль: Текущий пароль' }).click();
  await expect(page.getByLabel('Текущий пароль', { exact: true })).toHaveValue('Oldpass1');
  await page.getByRole('button', { name: 'Сохранить пароль' }).click();
  await expect(page.getByText('Неверный текущий пароль.', { exact: false }).first()).toBeVisible();
  await expect(page.getByLabel('Новый пароль', { exact: true })).toHaveValue('Newpass1');
  await page.getByRole('button', { name: 'Очистить поля' }).click();
  await expect(page.getByLabel('Текущий пароль', { exact: true })).toHaveValue('');
});

test('ограниченная сессия сохраняет форму и выход', async ({ page }) => {
  await mock(page, { restricted: true });
  await page.goto('account/change-password');
  await expect(page.getByRole('heading', { name: 'Задайте постоянный пароль' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ключи доступа' })).toHaveCount(0);
  await expect(page.locator('.workspace-navigation')).toHaveCount(0);
  const logout = page.waitForRequest(
    (request) => request.url().endsWith('/auth/logout') && request.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Выйти' }).click();
  await logout;
});

test('назначение адресно и требует подтверждения, формы отправляются один раз', async ({
  page,
}) => {
  await mock(page);
  const writes: { url: string; body: Record<string, unknown> }[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/admin/users')) {
      writes.push({ url: request.url(), body: request.postDataJSON() });
    }
  });
  await page.goto('admin/users');
  await page.getByRole('button', { name: 'Добавить пользователя' }).click();
  await page.getByLabel('Имя', { exact: true }).fill('Новый администратор');
  await page.getByLabel('Логин', { exact: true }).fill('new-admin');
  await page.getByLabel('Временный пароль', { exact: true }).fill('Testpass123');
  await page.getByRole('button', { name: 'Создать администратора' }).click();
  await expect(page.getByRole('status')).toContainText('Временный пароль назначен');
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toMatchObject({ login: 'new-admin', role: 'ADMIN' });
  await page
    .locator('.user-row')
    .nth(1)
    .getByRole('button', { name: 'Назначить временный пароль' })
    .click();
  await page.getByLabel('Временный пароль', { exact: true }).fill('Testpass123');
  await page
    .locator('section.form-card')
    .getByRole('button', { name: 'Назначить временный пароль', exact: true })
    .click();
  expect(writes).toHaveLength(1);
  await page.getByRole('checkbox').check();
  await page
    .locator('section.form-card')
    .getByRole('button', { name: 'Назначить временный пароль', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Временный пароль назначен');
  expect(writes).toHaveLength(2);
  expect(writes[1].url).toContain('/admin/users/other/temporary-password');
  expect(writes[1].body.revision).toBe(1);
  await expect(page.getByRole('button', { name: 'Назад' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Далее' })).toBeDisabled();
});

test('пустые ключи, клавиатура и размеры элементов', async ({ page, browserName }) => {
  await mock(page);
  await page.goto('account/security');
  await expect(page.getByRole('button', { name: 'Проверить ключ доступа' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Подтвердить пароль заново' })).toHaveAttribute(
    'href',
    /auth\/login\?next=/,
  );
  await expect(page.getByLabel('Название ключа')).toBeVisible();
  const current = page.getByLabel('Текущий пароль', { exact: true });
  await current.focus();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.getByRole('button', { name: 'Показать пароль: Текущий пароль' })).toBeFocused();
  const outline = await page.locator(':focus').evaluate((el) => ({
    style: getComputedStyle(el).outlineStyle,
    width: getComputedStyle(el).outlineWidth,
  }));
  expect(outline.style).not.toBe('none');
  expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Space');
  await expect(current).toHaveAttribute('type', 'text');
  await page.goto('admin/users');
  for (const button of await page.locator('.user-row button').all()) {
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test('контраст текста, границ и фокуса', async ({ page }) => {
  await mock(page);
  await page.goto('account/security');
  await expect(page.locator('.security-layout')).toBeVisible();
  const samples = await page.evaluate(() => {
    const color = (
      selector: string,
      property: 'color' | 'backgroundColor' | 'borderColor' | 'outlineColor',
    ) =>
      getComputedStyle(document.querySelector(selector)!).getPropertyValue(
        property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`),
      );
    return {
      ink: color('.security-layout p', 'color'),
      white: color('.security-keys', 'backgroundColor'),
      buttonText: color('.security-layout form button.button', 'color'),
      buttonBg: color('.security-layout form button.button', 'backgroundColor'),
      border: color('.security-layout input', 'borderColor'),
      inputBg: color('.security-layout input', 'backgroundColor'),
      focus: color('.password-toggle', 'color'),
    };
  });
  function contrast(a: string, b: string) {
    const lum = (value: string) =>
      value
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((x) => x / 255)
        .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
        .reduce((sum, x, i) => sum + x * [0.2126, 0.7152, 0.0722][i], 0);
    const x = lum(a),
      y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  expect(contrast(samples.ink, samples.white)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(samples.buttonText, samples.buttonBg)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(samples.border, samples.inputBg)).toBeGreaterThanOrEqual(3);
  expect(contrast(samples.focus, samples.inputBg)).toBeGreaterThanOrEqual(3);
});

test('загрузка, ошибки и переход между страницами', async ({ page }) => {
  await mock(page);
  let failing = false;
  await page.route('**/api/v1/admin/users?*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (failing)
      return route.fulfill({
        status: 503,
        json: {
          code: 'SERVICE_UNAVAILABLE',
          requestId: 'fixture',
          detail: 'Список временно недоступен.',
          fieldErrors: {},
        },
      });
    const number = Number(new URL(route.request().url()).searchParams.get('page'));
    return route.fulfill({
      json: {
        items: number ? [users[2]] : [users[0], users[1]],
        page: number,
        size: 25,
        total: 26,
      },
    });
  });
  await page.goto('admin/users');
  await expect(page.getByText('Загрузка пользователей…')).toBeVisible();
  await expect(page.locator('.user-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Далее' }).click();
  await expect(page.getByText('Страница 2')).toBeVisible();
  await expect(page.locator('.user-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(page.getByText('Страница 1')).toBeVisible();
  failing = true;
  await page.reload();
  await expect(page.getByText('Список временно недоступен.').first()).toBeVisible();
});

test('повторная отправка пароля не создаёт параллельный запрос', async ({ page }) => {
  await mock(page);
  let sent = 0;
  await page.route('**/api/v1/auth/change-password', async (route) => {
    sent++;
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({
      status: 400,
      json: {
        code: 'INVALID_PASSWORD',
        requestId: 'fixture',
        detail: 'Проверьте пароль.',
        fieldErrors: {},
      },
    });
  });
  await page.goto('account/security');
  await page.getByLabel('Текущий пароль', { exact: true }).fill('Oldpass1');
  await page.getByLabel('Новый пароль', { exact: true }).fill('Newpass1');
  await page.getByLabel('Повторите новый пароль', { exact: true }).fill('Newpass1');
  await page
    .locator('.security-layout form')
    .first()
    .evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
  await expect(page.getByText('Проверьте пароль.').first()).toBeVisible();
  expect(sent).toBe(1);
});

test('повторное создание пользователя не создаёт параллельный запрос', async ({ page }) => {
  await mock(page);
  let sent = 0;
  await page.route('**/api/v1/admin/users', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    sent++;
    await new Promise((resolve) => setTimeout(resolve, 400));
    await route.fulfill({
      status: 400,
      json: {
        code: 'INVALID',
        requestId: 'fixture',
        detail: 'Проверьте пользователя.',
        fieldErrors: {},
      },
    });
  });
  await page.goto('admin/users');
  await page.getByRole('button', { name: 'Добавить пользователя' }).click();
  await page.getByLabel('Имя', { exact: true }).fill('Новый администратор');
  await page.getByLabel('Логин', { exact: true }).fill('new-admin');
  await page.getByLabel('Временный пароль', { exact: true }).fill('Testpass123');
  await page.locator('section.user-management-form form').evaluate((form: HTMLFormElement) => {
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page.getByText('Проверьте пользователя.').first()).toBeVisible();
  expect(sent).toBe(1);
  await expect(page.getByLabel('Имя', { exact: true })).toHaveValue('Новый администратор');
});

test('фокус и формы доступны на разных размерах', async ({ page }) => {
  await mock(page, { keys: 1, long: true });
  for (const path of ['admin/users', 'account/security']) {
    await page.goto(path);
    if (path === 'admin/users')
      await page.getByRole('button', { name: 'Добавить пользователя' }).click();
    else await expect(page.getByRole('heading', { name: 'Ключи доступа' })).toBeVisible();
    for (const scale of [1, 2]) {
      const style = await page.addStyleTag({ content: `html { font-size: ${scale * 100}% }` });
      for (const width of scale === 1
        ? [320, 375, 430, 768, 1000, 1280, 1440]
        : [320, 375, 768, 1440]) {
        await page.setViewportSize({ width, height: 650 });
        await noOverflow(page);
        const controls = page
          .locator(
            path === 'admin/users'
              ? 'section.form-card :is(input,button)'
              : '.security-layout :is(input,button,a.button)',
          )
          .filter({ visible: true });
        for (const control of await controls.all()) {
          if (await control.isDisabled()) continue;
          await page.keyboard.press('Tab');
          await control.focus();
          const result = await control.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const css = getComputedStyle(element);
            let clipped = false;
            for (let parent = element.parentElement; parent; parent = parent.parentElement) {
              const p = getComputedStyle(parent),
                r = parent.getBoundingClientRect();
              if (
                (p.overflowX === 'hidden' || p.overflowX === 'clip') &&
                (box.left < r.left + 3 || box.right > r.right - 3)
              )
                clipped = true;
              if (
                (p.overflowY === 'hidden' || p.overflowY === 'clip') &&
                (box.top < r.top + 3 || box.bottom > r.bottom - 3)
              )
                clipped = true;
            }
            return {
              clipped,
              width: box.width,
              height: box.height,
              outline: css.outlineStyle,
              outlineWidth: parseFloat(css.outlineWidth),
            };
          });
          expect(result.clipped).toBe(false);
          expect(result.width).toBeGreaterThanOrEqual(44);
          expect(result.height).toBeGreaterThanOrEqual(44);
          expect(result.outline).not.toBe('none');
          expect(result.outlineWidth).toBeGreaterThanOrEqual(2);
        }
      }
      await style.evaluate((element) => element.parentNode?.removeChild(element));
    }
  }
});

test('соседние разделы и главная сохраняют навигацию', async ({ page }) => {
  await mock(page);
  for (const path of ['admin/requests', 'admin/payments']) {
    await page.goto(path);
    await expect(page.locator('.workspace-navigation a')).toHaveCount(5);
    await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();
    await noOverflow(page);
  }
  await page.goto('');
  await expect(page.getByRole('link', { name: 'О занятиях' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Кабинет администратора' }).first()).toBeVisible();
});
