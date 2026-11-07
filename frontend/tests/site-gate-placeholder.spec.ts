import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

let server: Server;
let origin: string;

test.beforeAll(async () => {
  const html = await readFile(resolve(process.cwd(), '../infra/site-gate/placeholder.html'));
  const logo = await readFile(resolve(process.cwd(), 'public/images/logo-turquoise.svg'));
  const nginx = await readFile(
    resolve(process.cwd(), '../infra/site-gate/nginx-site.conf.template'),
    'utf8',
  );
  const referrerPolicy = nginx.match(/add_header Referrer-Policy ([\w-]+) always;/)?.[1];
  if (!referrerPolicy) throw new Error('Missing gate referrer policy');
  server = createServer((request, response) => {
    response.setHeader('Referrer-Policy', referrerPolicy);
    if (request.method === 'POST' && request.url === '/__gate/login') {
      response.writeHead(request.headers.origin === origin ? 200 : 403, {
        'Content-Type': 'text/plain',
      });
      response.end(request.headers.origin === origin ? 'Origin accepted' : 'Origin rejected');
    } else if (request.url === '/__gate/logo.svg') {
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      response.end(logo);
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html);
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not start');
  origin = `http://127.0.0.1:${address.port}`;
});

test('браузер отправляет корректный Origin при отправке формы', async ({ page }) => {
  await page.goto(origin);
  const bird = page.getByRole('button', { name: 'Ласточка', exact: true });
  for (let i = 0; i < 3; i++) await bird.click();
  await page.getByLabel('Пароль для доступа').fill('synthetic-password');
  await page.locator('form[action="/__gate/login"] button[type="submit"]').click();
  await expect(page.getByText('Origin accepted')).toBeVisible();
});

test.afterAll(async () => {
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
});

test('форма открывается только после трёх нажатий мышью', async ({ page }) => {
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'Сайт в разработке' })).toBeVisible();
  const bird = page.getByRole('button', { name: 'Ласточка', exact: true });
  const password = page.getByLabel('Пароль для доступа');
  await expect(password).toBeHidden();
  await bird.click();
  await bird.click();
  await expect(password).toBeHidden();
  await bird.click();
  await expect(password).toBeVisible();
  await expect(password).toBeFocused();
  await expect(bird).toHaveAttribute('aria-expanded', 'true');
});

test('форма доступна с клавиатуры на узком экране', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto(origin);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Ласточка', exact: true })).toBeFocused();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Enter');
  await expect(page.getByLabel('Пароль для доступа')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('три касания открывают форму', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    viewport: { width: 375, height: 667 },
  });
  const page = await context.newPage();
  try {
    await page.goto(origin);
    const bird = page.getByRole('button', { name: 'Ласточка', exact: true });
    for (let i = 0; i < 3; i++) await bird.tap();
    await expect(page.getByLabel('Пароль для доступа')).toBeVisible();
  } finally {
    await context.close();
  }
});
