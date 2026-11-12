import { expect, test, type Page } from '@playwright/test';

const sizes = [
  { width: 320, height: 568, text: 100 },
  { width: 375, height: 812, text: 100 },
  { width: 390, height: 844, text: 100 },
  { width: 600, height: 812, text: 100 },
  { width: 600, height: 812, text: 200 },
  { width: 601, height: 812, text: 200 },
  { width: 768, height: 1024, text: 100 },
  { width: 1440, height: 900, text: 100 },
  { width: 320, height: 568, text: 200 },
  { width: 667, height: 375, text: 200 },
];

async function betweenPanels(page: Page, selector: string) {
  const target = page.locator(selector).first();
  await target.focus();
  await expect(target).toBeFocused();
  await expect
    .poll(() =>
      target.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const header = document.querySelector('.header')!.getBoundingClientRect();
        const footer = document.querySelector('.site-footer')!.getBoundingClientRect();
        return box.top >= header.bottom + 5 && box.bottom <= footer.top - 5;
      }),
    )
    .toBe(true);
}

for (const javaScriptEnabled of [true, false]) {
  test(`нижняя панель и форма доступны: JavaScript ${javaScriptEnabled}`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled });
    const page = await context.newPage();
    await page.goto(new URL('enquiry', baseURL).toString(), { waitUntil: 'domcontentloaded' });
    for (const size of sizes) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.evaluate(
        (text) => (document.documentElement.style.fontSize = `${text}%`),
        size.text,
      );
      await expect(page.locator('.site-footer a')).toHaveCount(6);
      for (const fraction of [0, 0.5, 1, 0]) {
        await page.evaluate(
          (value) => scrollTo(0, document.documentElement.scrollHeight * value),
          fraction,
        );
        const result = await page.evaluate(() => {
          const footer = document.querySelector('.site-footer')!.getBoundingClientRect();
          const header = document.querySelector('.header')!.getBoundingClientRect();
          const links = [...document.querySelectorAll('.site-footer a')].map((item) => {
            const rect = item.getBoundingClientRect();
            return (
              rect.left >= 0 &&
              rect.right <= innerWidth + 1 &&
              rect.top >= footer.top - 1 &&
              rect.bottom <= footer.bottom + 1 &&
              item.scrollWidth <= rect.width + 1 &&
              rect.height >= 44
            );
          });
          return {
            footerBottom: footer.bottom,
            gap: footer.top - header.bottom,
            headerTop: header.top,
            links,
            overflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        expect(Math.abs(result.footerBottom - size.height)).toBeLessThan(2);
        expect(Math.abs(result.headerTop)).toBeLessThan(2);
        expect(result.gap).toBeGreaterThan(0);
        expect(result.links.every(Boolean)).toBe(true);
        expect(result.overflow).toBe(false);
      }
      for (const selector of [
        'input[name="parentName"]',
        'input[name="phoneNational"]',
        'textarea[name="comment"]',
        'button[name="intent"][value="submit"]:not([hidden])',
      ])
        await betweenPanels(page, selector);
    }
    await context.close();
  });
}

for (const javaScriptEnabled of [true, false]) {
  test(`ссылки в подвале и запись ведут на нужные страницы: JavaScript ${javaScriptEnabled}`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled,
      viewport: { width: 375, height: 812 },
    });
    const page = await context.newPage();
    await page.goto(new URL('legal/terms', baseURL).toString());
    const footer = page.locator('.site-footer');
    await footer.getByRole('link', { name: 'Политика обработки персональных данных' }).click();
    await expect(page).toHaveURL(/\/legal\/privacy$/);
    await footer.getByRole('link', { name: 'Пользовательское соглашение' }).click();
    await expect(page).toHaveURL(/\/legal\/terms$/);
    await footer.getByRole('link', { name: 'Расписание', exact: true }).click();
    await expect(page).toHaveURL(/\/#schedule$/);
    await expect(page.locator('#schedule')).toBeAttached();
    await page
      .locator('.header')
      .getByRole('link', { name: /Записаться/ })
      .click();
    await expect(page).toHaveURL(/\/enquiry$/);
    await page.locator('input[name="parentName"]').fill('Проверка');
    await page.locator('button[name="intent"][value="submit"]:not([hidden])').click();
    const phone = page.locator('input[name="phoneNational"]');
    await expect(phone).toBeFocused();
    await expect
      .poll(() =>
        phone.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const header = document.querySelector('.header')!.getBoundingClientRect();
          const footer = document.querySelector('.site-footer')!.getBoundingClientRect();
          return rect.top >= header.bottom && rect.bottom <= footer.top;
        }),
      )
      .toBe(true);
    await expect(page.locator('input[name="parentName"]')).toHaveValue('Проверка');
    await context.close();
  });
}

test('вход из закреплённого подвала сохраняет форму и возвращает фокус', async ({
  page,
  baseURL,
}) => {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ json: { state: 'ANONYMOUS' } }));
  const ready = page.waitForResponse((response) => response.url().includes('/api/v1/auth/me'));
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(new URL('enquiry', baseURL).toString());
  await ready;
  await page.locator('input[name="parentName"]').fill('Проверка');
  const entry = page.locator('.site-footer .admin-entry');
  await entry.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Логин')).toBeVisible();
  await dialog.getByRole('button', { name: 'Закрыть окно входа' }).click();
  await expect(entry).toBeFocused();
  await expect(page.locator('input[name="parentName"]')).toHaveValue('Проверка');
});

test('состояние администратора и адреса публичных ссылок сохранены', async ({ page, baseURL }) => {
  let state = 'FULL';
  const account = { id: 'test', login: 'test', name: 'Тест', role: 'ADMIN', roles: ['ADMIN'] };
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.split('/api/v1')[1];
    if (path === '/auth/me') return route.fulfill({ json: { state, account } });
    if (path === '/auth/csrf')
      return route.fulfill({ json: { headerName: 'X-CSRF-TOKEN', token: 'test' } });
    if (path === '/auth/logout') {
      state = 'ANONYMOUS';
      return route.fulfill({ json: {} });
    }
    if (path === '/auth/webauthn/credentials') return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
  await page.goto(new URL('legal/privacy', baseURL).toString());
  const footer = page.locator('.site-footer');
  await expect(footer.locator('.admin-entry')).toHaveText('Кабинет администратора');
  await expect(footer.locator('.admin-entry')).toHaveAttribute('href', /\/admin\/schedule$/);
  await expect(footer.getByRole('link', { name: 'Сообщество ВКонтакте' })).toHaveAttribute(
    'href',
    'https://vk.ru/lastochkagym',
  );
  await expect(
    footer.getByRole('link', { name: 'Политика обработки персональных данных' }),
  ).toHaveAttribute('href', /\/legal\/privacy$/);
  await expect(footer.getByRole('link', { name: 'Пользовательское соглашение' })).toHaveAttribute(
    'href',
    /\/legal\/terms$/,
  );
  await footer.locator('.admin-entry').click();
  await expect(page).toHaveURL(/\/admin\/schedule$/);
  await page.goto(new URL('account/security', baseURL).toString());
  const logout = page.locator('.header').getByRole('button', { name: 'Выйти', exact: true });
  await expect(logout).toBeVisible();
  await logout.click();
  await expect(footer.locator('.admin-entry')).toHaveText('Для администратора');
  state = 'PASSWORD_CHANGE_REQUIRED';
  await page.goto(new URL('legal/privacy', baseURL).toString());
  await expect(footer.locator('.admin-entry')).toHaveText('Сменить пароль');
  await expect(footer.locator('.admin-entry')).toHaveAttribute(
    'href',
    /\/account\/change-password$/,
  );
});

test('ошибка проверки входа не скрывает ссылки на коротком экране', async ({ page, baseURL }) => {
  let failed = true;
  await page.route('**/api/v1/auth/me', (route) =>
    failed
      ? route.fulfill({ status: 503, json: { detail: 'Недоступно' } })
      : route.fulfill({ json: { state: 'ANONYMOUS' } }),
  );
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(new URL('legal/privacy', baseURL).toString());
  await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
  const retry = page.getByRole('link', { name: 'Повторить проверку входа' });
  await expect(retry).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Не удалось проверить вход');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const footer = document.querySelector('.site-footer')!.getBoundingClientRect();
        const header = document.querySelector('.header')!.getBoundingClientRect();
        return footer.top - header.bottom;
      }),
    )
    .toBeGreaterThan(75);
  failed = false;
  await retry.click();
  await expect(page.getByRole('dialog').getByLabel('Логин')).toBeVisible();
});
