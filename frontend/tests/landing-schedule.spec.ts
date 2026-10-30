import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const base = (process.env.TEST_APP_URL ?? 'http://localhost:18094/lastochka/').replace(/\/$/, '');
const output =
  process.env.LANDING_SCHEDULE_OUTPUT ??
  new URL('../../artifacts/landing-schedule/after', import.meta.url).pathname;
mkdirSync(output, { recursive: true });
async function target(page: Page) {
  await expect(page).toHaveURL(base + '/#schedule');
  await expect
    .poll(() =>
      page.locator('#schedule-heading').evaluate((n) => {
        const r = n.getBoundingClientRect(),
          h = document.querySelector('.header')!.getBoundingClientRect();
        return (
          r.top >=
            (getComputedStyle(document.querySelector('.header')!).position === 'sticky'
              ? h.bottom
              : 0) && r.top < innerHeight
        );
      }),
    )
    .toBe(true);
}
async function navigate(page: Page) {
  const desktop = page.getByRole('navigation', { name: 'Основная навигация' });
  if (await desktop.isVisible())
    await desktop.getByRole('link', { name: 'Расписание', exact: true }).click();
  else {
    await page.getByRole('button', { name: 'Меню', exact: true }).click();
    await page
      .getByRole('navigation', { name: 'Навигация по разделам' })
      .getByRole('link', { name: 'Расписание', exact: true })
      .click();
  }
  await target(page);
}
test('header anchors, repeat, footer, deep link, reload and removed page', async ({
  page,
  request,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/enquiry');
  await navigate(page);
  await expect(page.locator('#schedule')).toHaveCount(1);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  const ids = await page.locator('main > section').evaluateAll((ns) => ns.map((n) => n.id));
  expect(ids.indexOf('schedule')).toBe(ids.indexOf('formats') + 1);
  expect(await page.locator('h2#schedule-heading').count()).toBe(1);
  await page.getByRole('button', { name: 'Следующая неделя', exact: true }).click();
  const value = await page.getByLabel('Дата', { exact: true }).inputValue();
  await page.locator('#contacts').scrollIntoViewIfNeeded();
  await navigate(page);
  await expect(page.getByLabel('Дата', { exact: true })).toHaveValue(value);
  await page.reload();
  await target(page);
  await page.locator('footer').getByRole('link', { name: 'Расписание', exact: true }).click();
  await target(page);
  await page.getByRole('link', { name: 'Посмотреть расписание', exact: true }).click();
  await target(page);
  const gone = await request.get(base + '/schedule', { maxRedirects: 0 });
  expect(gone.status()).toBe(404);
  expect(gone.headers().location).toBeUndefined();
  expect(await page.locator('a[href="/lastochka/schedule"]').count()).toBe(0);
  await page.screenshot({ path: `${output}/${info.project.name}-anchor.png` });
  expect(errors).toEqual([]);
});
test('five links, breakpoint geometry, enlarged text and focus', async ({ page }, info) => {
  await page.goto(base + '/#schedule');
  await target(page);
  for (const width of [320, 375, 768, 1000, 1001, 1100, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    const nav = page.getByRole('navigation', { name: 'Основная навигация' });
    if (width > 1000) {
      await expect(nav).toBeVisible();
      await expect(nav.getByRole('link')).toHaveCount(5);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.getByLabel('Дата', { exact: true }).focus();
    await expect
      .poll(() =>
        page
          .getByLabel('Дата', { exact: true })
          .evaluate(
            (n) =>
              n.getBoundingClientRect().top >=
              (innerWidth <= 1000
                ? document.querySelector('.header')!.getBoundingClientRect().bottom
                : 0),
          ),
      )
      .toBe(true);
    await page.screenshot({ path: `${output}/${info.project.name}-${width}.png` });
  }
  for (const width of [320, 375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
    await page.getByLabel('Дата', { exact: true }).focus();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: `${output}/${info.project.name}-${width}-200.png` });
    await page.evaluate(() => (document.documentElement.style.fontSize = ''));
  }
});
test('no-JS anchors and working form, reduced motion', async ({ browser }, info) => {
  const c = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 375, height: 844 },
    locale: info.project.use.locale,
    reducedMotion: 'reduce',
  });
  const p = await c.newPage();
  await p.goto(base + '/#schedule');
  await expect(p.locator('#schedule-heading')).toBeVisible();
  await expect(p.locator('.schedule-enhanced')).toBeHidden();
  await expect(p.locator('.schedule-static')).toContainText('форме заявки');
  await p.locator('.mobile-menu-fallback summary').click();
  await p
    .getByRole('navigation', { name: 'Навигация по разделам' })
    .getByRole('link', { name: 'Расписание', exact: true })
    .click();
  await expect(p).toHaveURL(base + '/#schedule');
  await p.locator('.schedule-static a').click();
  await expect(p).toHaveURL(base + '/enquiry');
  await expect(p.getByLabel('Телефон', { exact: true })).toBeVisible();
  await c.close();
});
function sql(query: string) {
  if (
    base !== 'http://localhost:18094/lastochka' ||
    process.env.TEST_DATABASE_CONTAINER !== 'lastochka-editor-postgres'
  )
    throw Error('Isolated database required');
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'lastochka-editor-postgres',
      'psql',
      '-U',
      'lastochka',
      '-d',
      'lastochka_editor',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: query, encoding: 'utf8' },
  ).trim();
}
test('hidden and reordered blocks preserve a single schedule', async ({ page }, info) => {
  test.skip(
    !!process.env.LANDING_SCHEDULE_READ_ONLY,
    'Content revisions are only tested in isolated local DB',
  );
  const original = JSON.parse(sql('SELECT payload::text FROM landing_content WHERE id=1;'));
  try {
    for (const mode of ['hidden', 'reordered', 'fallback']) {
      const doc = structuredClone(original);
      doc.revision += 100;
      if (mode === 'hidden')
        doc.blocks.find((b: { kind: string }) => b.kind === 'formats').visible = false;
      if (mode === 'reordered') doc.blocks.reverse();
      if (mode === 'fallback')
        for (const b of doc.blocks)
          if (['formats', 'steps', 'contacts'].includes(b.kind)) b.visible = false;
      const payload = JSON.stringify(doc).replaceAll("'", "''");
      sql(
        `UPDATE landing_content SET revision=${doc.revision},payload='${payload}'::jsonb WHERE id=1;`,
      );
      await page.goto(base + '/');
      await expect(page.locator('#schedule')).toHaveCount(1);
      const ids = await page.locator('main > section').evaluateAll((ns) => ns.map((n) => n.id));
      expect(ids.filter((id) => id !== 'schedule')).toEqual(
        doc.blocks
          .filter((b: { visible?: boolean }) => b.visible !== false)
          .map((b: { id: string }) => b.id),
      );
      if (mode === 'hidden')
        expect(ids.indexOf('schedule')).toBe(
          ids.indexOf('first-visit') >= 0
            ? ids.indexOf('first-visit') - 1
            : ids.indexOf('steps') - 1,
        );
      if (mode === 'fallback') expect(ids.at(-1)).toBe('schedule');
      const result = JSON.parse(sql('SELECT payload::text FROM landing_content WHERE id=1;'));
      expect(result).toEqual(doc);
    }
  } finally {
    const payload = JSON.stringify(original).replaceAll("'", "''");
    sql(
      `UPDATE landing_content SET revision=${original.revision},payload='${payload}'::jsonb WHERE id=1;`,
    );
  }
});

test('published states and card preselection use the actual isolated API', async ({
  page,
}, info) => {
  test.skip(!!process.env.LANDING_SCHEDULE_READ_ONLY, 'Fixture writes are local only');
  sql('DELETE FROM auth_limits;');
  const csrf = await (await page.request.get(base + '/api/v1/auth/csrf')).json();
  expect(
    (
      await page.request.post(base + '/api/v1/auth/password-stage', {
        headers: { [csrf.headerName]: csrf.token, Origin: new URL(base).origin },
        data: { login: 'editor-admin', password: 'Fixture-pass-123' },
      })
    ).ok(),
  ).toBe(true);
  async function command(path: string, body: unknown) {
    const c = await (await page.request.get(base + '/api/v1/auth/csrf')).json();
    const r = await page.request.post(base + '/api/v1' + path, {
      headers: {
        [c.headerName]: c.token,
        Origin: new URL(base).origin,
        'Idempotency-Key': crypto.randomUUID(),
      },
      data: body,
    });
    expect(r.ok(), path + ' ' + r.status()).toBe(true);
    return r.json();
  }
  const project = [
    'chromium-en-US-375',
    'chromium-en-US-1440',
    'chromium-ru-RU-375',
    'chromium-ru-RU-1440',
    'webkit-en-US-375',
    'webkit-en-US-1440',
    'webkit-ru-RU-375',
    'webkit-ru-RU-1440',
  ].indexOf(info.project.name);
  const day = new Date(Date.now() + (180 + project * 7) * 86400000).toISOString().slice(0, 10);
  for (const [i, state] of ['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED'].entries()) {
    const start = new Date(day + 'T' + String(9 + i).padStart(2, '0') + ':00:00+03:00');
    let s = await command('/admin/sessions', {
      title: 'Проверка ' + state,
      format: 'GROUP',
      capacity: 6,
      startsAt: start.toISOString(),
      endsAt: new Date(+start + 3000000).toISOString(),
    });
    if (state !== 'DRAFT')
      s = await command(`/admin/sessions/${s.id}/actions`, {
        expectedVersion: s.version,
        action: 'PUBLISH',
      });
    if (state === 'CLOSED' || state === 'CANCELLED')
      await command(`/admin/sessions/${s.id}/actions`, {
        expectedVersion: s.version,
        action: state === 'CLOSED' ? 'CLOSE' : 'CANCEL',
        reason: 'Проверка публичного отображения',
      });
  }
  await page.goto(base + '/#schedule');
  await page.getByLabel('Дата', { exact: true }).fill(day);
  await expect(page.locator('.session-card')).toHaveCount(2);
  await expect(page.locator('#schedule')).not.toContainText('Проверка DRAFT');
  await expect(page.locator('#schedule')).not.toContainText('Проверка CANCELLED');
  const closed = page.locator('.session-card').filter({ hasText: 'Проверка CLOSED' });
  await expect(closed.getByRole('link')).toHaveCount(0);
  await page
    .locator('.session-card')
    .filter({ hasText: 'Проверка OPEN' })
    .getByRole('link')
    .click();
  await expect(page).toHaveURL(/\/enquiry\?session=/);
  await expect(page.getByLabel('Желаемое занятие')).toContainText('Проверка OPEN');
});
