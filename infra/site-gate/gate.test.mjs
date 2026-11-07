import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGate } from './gate.mjs';

const directory = mkdtempSync(join(tmpdir(), 'lastochka-gate-test-'));
const password = 'synthetic gate password 123';
const salt = randomBytes(16);
const hashPath = join(directory, 'password.hash');
const keyPath = join(directory, 'session.key');
const placeholderPath = join(directory, 'placeholder.html');
const logoPath = join(directory, 'logo.svg');
writeFileSync(hashPath, `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`);
writeFileSync(keyPath, randomBytes(32));
writeFileSync(placeholderPath, '<input name="csrf" value="{{CSRF_TOKEN}}">');
writeFileSync(logoPath, '<svg xmlns="http://www.w3.org/2000/svg"/>');
const origin = 'https://test.example.test';
let clock = 1800000000000;
const gate = createGate({ origin, passwordHashPath: hashPath, sessionKeyPath: keyPath, placeholderPath, logoPath, now: () => clock });
await new Promise((resolve) => gate.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${gate.address().port}`;
after(async () => {
  await new Promise((resolve, reject) => gate.close((error) => error ? reject(error) : resolve()));
  rmSync(directory, { recursive: true, force: true });
});

async function form() {
  const response = await fetch(`${url}/__gate/`);
  const html = await response.text();
  const csrf = html.match(/value="([A-Za-z0-9_-]+)"/)[1];
  const cookie = response.headers.get('set-cookie').split(';')[0];
  return { csrf, cookie };
}

function login(values, inputPassword = password, extra = {}) {
  return fetch(`${url}/__gate/login`, {
    method: 'POST', redirect: 'manual',
    headers: { origin, cookie: values.cookie, 'content-type': 'application/x-www-form-urlencoded', ...extra },
    body: new URLSearchParams({ csrf: values.csrf, password: inputPassword }),
  });
}

test('anonymous and forged sessions cannot pass the gate', async () => {
  assert.equal((await fetch(`${url}/__gate/verify`)).status, 401);
  assert.equal((await fetch(`${url}/__gate/verify`, { headers: { cookie: '__Host-lastochka_gate=1.fake.signature' } })).status, 401);
  assert.equal((await fetch(`${url}/__gate/verify`, { headers: { cookie: 'x=1; x=2' } })).status, 400);
});

test('login requires origin and CSRF, then issues an expiring secure session', async () => {
  const values = await form();
  assert.equal((await login(values, password, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await login({ ...values, csrf: 'wrong' })).status, 403);
  const response = await login(values);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/lastochka/');
  const raw = response.headers.get('set-cookie');
  assert.match(raw, /Secure; HttpOnly; SameSite=Strict/);
  const session = raw.split(';')[0];
  assert.equal((await fetch(`${url}/__gate/verify`, { headers: { cookie: session } })).status, 204);
  clock += 8 * 60 * 60 * 1000;
  assert.equal((await fetch(`${url}/__gate/verify`, { headers: { cookie: session } })).status, 401);
});

test('repeated bad passwords are rate limited and unrelated clients remain usable', async () => {
  const values = await form();
  for (let i = 0; i < 5; i++) assert.equal((await login(values, 'wrong', { 'x-real-ip': '192.0.2.1' })).status, 401);
  assert.equal((await login(values, password, { 'x-real-ip': '192.0.2.1' })).status, 429);
  assert.equal((await login(values, password, { 'x-real-ip': '192.0.2.2' })).status, 303);
  clock += 11 * 60 * 1000;
  assert.equal((await login(values, password, { 'x-real-ip': '192.0.2.1' })).status, 303);
});

test('unexpected endpoints and query strings are refused', async () => {
  assert.equal((await fetch(`${url}/lastochka/`)).status, 404);
  assert.equal((await fetch(`${url}/__gate/verify?token=value`)).status, 400);
  assert.equal((await fetch(`${url}/__gate/logo.svg`)).status, 200);
});

test('logout clears the session cookie with CSRF protection', async () => {
  const values = await form();
  const loginResponse = await login(values, password, { 'x-real-ip': '192.0.2.4' });
  const session = loginResponse.headers.get('set-cookie').split(';')[0];
  const response = await fetch(`${url}/__gate/logout`, {
    method: 'POST', redirect: 'manual',
    headers: { origin, cookie: `${values.cookie}; ${session}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf: values.csrf }),
  });
  assert.equal(response.status, 303);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(response.headers.get('location'), '/__gate/');
  assert.equal((await fetch(`${url}/__gate/verify`, { headers: { cookie: session } })).status, 401);
});

test('sessions from another environment are not accepted', async () => {
  const values = await form();
  const response = await login(values, password, { 'x-real-ip': '192.0.2.3' });
  const session = response.headers.get('set-cookie').split(';')[0];
  const otherKey = join(directory, 'other.key');
  writeFileSync(otherKey, randomBytes(32));
  const other = createGate({ origin: 'https://other.example.test', passwordHashPath: hashPath, sessionKeyPath: otherKey, placeholderPath, logoPath, now: () => clock });
  await new Promise((resolve) => other.listen(0, '127.0.0.1', resolve));
  try {
    const result = await fetch(`http://127.0.0.1:${other.address().port}/__gate/verify`, { headers: { cookie: session } });
    assert.equal(result.status, 401);
  } finally {
    await new Promise((resolve, reject) => other.close((error) => error ? reject(error) : resolve()));
  }
});
