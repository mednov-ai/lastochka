// Runs only inside the disposable stack created by test-root-stack.py.
import { chromium } from '@playwright/test';
import { writeFile, access } from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.ROOT_FIXTURE_URL;
const directory = process.env.ROOT_FIXTURE_CONTROL;
if (!/^http:\/\/localhost:\d+$/.test(base ?? '') || !/^\/.*lastochka-root-control-[^/]+$/.test(directory ?? '')) {
  throw new Error('Disposable root fixture is required');
}
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  let writes = 0;
  page.on('request', (request) => { if (['POST', 'PUT', 'DELETE'].includes(request.method())) writes++; });
  await page.goto(`${base}/lastochka/`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('#schedule').count(), 1);
  const html = await page.content();
  assert.ok(html.includes('/lastochka/assets/'), 'The warm tab must load the old build');
  await writeFile(`${directory}/switch-request`, 'switch');
  for (let i = 0; i < 300; i++) {
    try { await access(`${directory}/switch-done`); break; } catch { /* wait for fixture */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (i === 299) throw new Error('Fixture switch timed out');
  }
  await page.getByRole('link', { name: /Оставить заявку|Записаться/ }).first().click();
  await page.waitForURL(/\/enquiry(?:\?|$)/, { timeout: 15000 });
  await page.getByRole('heading', { name: 'Заявка на занятие' }).waitFor();
  assert.equal(writes, 0, 'A warm tab must not silently submit an old command');
  await page.reload();
  assert.equal(new URL(page.url()).pathname, '/enquiry');
  console.log('Warm old-build tab navigated safely and reloaded at the new root');
} finally { await browser.close(); }
