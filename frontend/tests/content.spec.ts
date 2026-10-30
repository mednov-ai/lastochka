import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { base } from './support/actors';
const root = resolve('..');
function sql(query: string) {
  if (process.env.TEST_DATABASE_CONTAINER) {
    const result = spawnSync(
      'docker',
      [
        'exec',
        '-i',
        process.env.TEST_DATABASE_CONTAINER,
        'psql',
        '-U',
        'lastochka',
        '-d',
        process.env.TEST_DATABASE_NAME ?? 'lastochka_concept',
        '-At',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      { input: query, encoding: 'utf8' },
    );
    if (result.status !== 0) throw new Error('Fixture SQL failed');
    return result.stdout.trim();
  }
  const preview = process.env.TEST_PREVIEW === '1';
  const args = [
    'compose',
    ...(preview ? ['--env-file', resolve(root, 'runtime-data/preview.env')] : []),
    '-f',
    resolve(root, preview ? 'compose.preview.yaml' : 'compose.local.yaml'),
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'lastochka',
    '-d',
    'lastochka',
    '-At',
    '-v',
    'ON_ERROR_STOP=1',
  ];
  const result = spawnSync('docker', args, { input: query, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Fixture SQL failed: ' + result.stderr);
  return result.stdout.trim();
}
function replace(doc: object) {
  const payload = JSON.stringify(doc).replaceAll("'", "''");
  sql(
    `UPDATE landing_content SET revision=( '${payload}'::jsonb->>'revision')::bigint,payload='${payload}'::jsonb WHERE id=1;`,
  );
}
test('published content changes SSR, hydration, metadata and ETag without rebuilding; survives restart', async ({
  page,
}) => {
  test.setTimeout(90000);
  const original = JSON.parse(sql('SELECT payload::text FROM landing_content WHERE id=1;'));
  const initial = await page.request.get(base + '/api/v1/public/landing');
  const doc = structuredClone(original);
  doc.revision++;
  doc.title = 'Ласточка — проверка опубликованного наполнения';
  doc.description = 'Метаданные изменены без пересборки';
  doc.blocks.find((b: { id: string }) => b.id === 'hero').title =
    'Новый первый экран. Новое движение.';
  doc.blocks.find((b: { id: string }) => b.id === 'hero').image = 'balance.webp';
  doc.blocks.find((b: { id: string }) => b.id === 'hero').alt = 'Новое описание иллюстрации';
  doc.blocks.find((b: { id: string }) => b.id === 'hero').text =
    '<script>window.contentExecuted=true</script>';
  doc.blocks.find((b: { id: string }) => b.id === 'approach').motionPreset =
    'unknown-future-preset';
  doc.blocks.find((b: { id: string }) => b.id === 'coach').visible = false;
  [doc.blocks[1], doc.blocks[2]] = [doc.blocks[2], doc.blocks[1]];
  try {
    replace(doc);
    const changed = await page.request.get(base + '/api/v1/public/landing');
    expect(changed.headers().etag).not.toBe(initial.headers().etag);
    expect(
      (
        await page.request.get(base + '/api/v1/public/landing', {
          headers: { 'If-None-Match': changed.headers().etag },
        })
      ).status(),
    ).toBe(304);
    const html = await (await page.request.get(base + '/')).text();
    expect(html).toContain('&lt;script&gt;');
    await page.goto(base + '/');
    await expect(page).toHaveTitle(doc.title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      doc.description,
    );
    await expect(
      page.getByRole('heading', { name: 'Новый первый экран. Новое движение.' }),
    ).toBeVisible();
    await expect(page.locator('#hero img')).toHaveAttribute('alt', 'Новое описание иллюстрации');
    await expect(page.locator('#hero img')).toHaveAttribute('src', /balance.webp$/);
    expect(await page.evaluate(() => Object.hasOwn(window, 'contentExecuted'))).toBe(false);
    expect(await page.locator('#approach').getAttribute('data-motion')).toBeNull();
    expect(await page.locator('#coach').count()).toBe(0);
    const order = await page.locator('main > section').evaluateAll((els) => els.map((el) => el.id));
    expect(order.indexOf('formats')).toBeLessThan(order.indexOf('approach'));
    const restart = process.env.TEST_DATABASE_CONTAINER
      ? spawnSync(
          'python3',
          [resolve(root, 'scripts/local-concept-preview.py'), 'restart-backend'],
          { encoding: 'utf8' },
        )
      : process.env.TEST_PREVIEW === '1'
        ? spawnSync(
            'docker',
            [
              'compose',
              '--env-file',
              resolve(root, 'runtime-data/preview.env'),
              '-f',
              resolve(root, 'compose.preview.yaml'),
              'restart',
              'backend',
            ],
            { encoding: 'utf8' },
          )
        : spawnSync('python3', [resolve(root, 'scripts/local-backend.py'), 'restart'], {
            encoding: 'utf8',
          });
    expect(restart.status).toBe(0);
    await expect
      .poll(
        async () => {
          try {
            return (await (await page.request.get(base + '/api/v1/public/landing')).json())
              .revision;
          } catch {
            return 0;
          }
        },
        { timeout: 45000 },
      )
      .toBe(doc.revision);
    await page.reload();
    await expect(page).toHaveTitle(doc.title);
    doc.blocks[0].image = 'javascript:alert(1)';
    replace(doc);
    expect((await page.request.get(base + '/api/v1/public/landing')).ok()).toBe(false);
  } finally {
    replace(original);
  }
});
