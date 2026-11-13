const { test, expect } = require('@playwright/test');
const { createHmac, randomBytes, scryptSync } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
let directory, gate, proxy, origin;

test.beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lastochka-browser-gate-'));
  const pepper = randomBytes(32), salt = randomBytes(16);
  const keyed = createHmac('sha256', pepper).update('0007').digest();
  for (const [name, data] of Object.entries({
    hash: `${salt.toString('hex')}:${scryptSync(keyed, salt, 64).toString('hex')}`,
    pepper, key: randomBytes(32), logo: '<svg xmlns="http://www.w3.org/2000/svg"/>',
  })) fs.writeFileSync(path.join(directory, name), data, { mode: 0o600 });
  execFileSync('python3', [path.join(root, 'scripts/init-maintenance-state.py'), '--path', path.join(directory, 'state'), '--zone', 'test']);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(directory, 'tls.key'), '-out', path.join(directory, 'tls.crt'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  proxy = https.createServer({ key: fs.readFileSync(path.join(directory, 'tls.key')), cert: fs.readFileSync(path.join(directory, 'tls.crt')) }, (req, res) => {
    if (req.url === '/app') { res.writeHead(200); res.end('App reached'); return; }
    const upstream = http.request({ host: '127.0.0.1', port: gate.address().port, path: req.url === '/' ? '/__gate/' : req.url, method: req.method, headers: req.headers }, upstreamRes => {
      res.writeHead(upstreamRes.statusCode, { ...upstreamRes.headers, 'referrer-policy': 'strict-origin' });
      upstreamRes.pipe(res);
    });
    req.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  origin = `https://127.0.0.1:${proxy.address().port}`;
  const { createGate } = await import('../../infra/site-gate/gate.mjs');
  gate = createGate({ origin, zone: 'test', passwordHashPath: path.join(directory, 'hash'), pepperPath: path.join(directory, 'pepper'), sessionKeyPath: path.join(directory, 'key'), statePath: path.join(directory, 'state'), placeholderPath: path.join(root, 'infra/site-gate/placeholder.html'), logoPath: path.join(directory, 'logo'), appPath: '/' });
  await new Promise(resolve => gate.listen(0, '127.0.0.1', resolve));
});

test.afterAll(async () => {
  if (proxy) await new Promise(resolve => proxy.close(resolve));
  if (gate) await new Promise(resolve => gate.close(resolve));
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
});

test('a second tab cannot invalidate the first tab PIN form', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: testInfo.project.use.viewport });
  const first = await context.newPage(), second = await context.newPage();
  await first.goto(origin);
  await second.goto(origin);
  for (const page of [first, second]) {
    const bird = page.getByRole('button', { name: 'Ласточка' });
    for (let i = 0; i < 3; i++) await bird.click();
    await page.locator('#pin').fill('0007');
    const response = page.waitForResponse(r => r.url().endsWith('/__gate/login') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Войти' }).click();
    expect((await response).status()).toBe(303);
  }
  await context.close();
});
