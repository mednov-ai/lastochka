import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, scryptSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createGate } from './gate.mjs';

async function fixture(zone = 'test', pin = '0007', appPath = '/lastochka/') {
  const directory = mkdtempSync(join(tmpdir(), 'lastochka-pin-fixture-'));
  const statePath = join(directory, 'state.sqlite');
  execFileSync('python3', [resolve('scripts/init-maintenance-state.py'), '--path', statePath, '--zone', zone]);
  const pepper = randomBytes(32), salt = randomBytes(16);
  const keyed = createHmac('sha256', pepper).update(pin).digest();
  const hashPath = join(directory, 'pin.hash'), pepperPath = join(directory, 'pepper'), keyPath = join(directory, 'session.key');
  const placeholderPath = join(directory, 'placeholder.html'), logoPath = join(directory, 'logo.svg');
  writeFileSync(hashPath, `${salt.toString('hex')}:${scryptSync(keyed, salt, 64).toString('hex')}`, { mode: 0o600 });
  writeFileSync(pepperPath, pepper, { mode: 0o600 });
  writeFileSync(keyPath, randomBytes(32), { mode: 0o600 });
  writeFileSync(placeholderPath, '<input name="csrf" value="{{CSRF_TOKEN}}">');
  writeFileSync(logoPath, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const origin = `https://${zone}.example.test`;
  let clock = 1800000000000;
  let server;
  async function start() {
    server = createGate({ origin, zone, passwordHashPath: hashPath, pepperPath, sessionKeyPath: keyPath, statePath, placeholderPath, logoPath, appPath, now: () => clock });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
  }
  async function stop() { await new Promise((done, reject) => server.close((error) => error ? reject(error) : done())); }
  try { await start(); } catch (error) { rmSync(directory, { recursive: true, force: true }); throw error; }
  const url = () => `http://127.0.0.1:${server.address().port}`;
  async function form(cookie = '') {
    const response = await fetch(`${url()}/__gate/`, { headers: { cookie } });
    return { csrf: (await response.text()).match(/value="([A-Za-z0-9_-]+)"/)[1], cookie: response.headers.get('set-cookie').split(';')[0] };
  }
  async function login(input = pin, ip = '192.0.2.1') {
    const values = await form();
    return fetch(`${url()}/__gate/login`, { method: 'POST', redirect: 'manual',
      headers: { origin, cookie: values.cookie, 'content-type': 'application/x-www-form-urlencoded', 'x-real-ip': ip },
      body: new URLSearchParams({ csrf: values.csrf, pin: input }) });
  }
  async function verify(session) { return fetch(`${url()}/__gate/verify`, { headers: { cookie: session } }); }
  return { directory, statePath, origin, pin, form, login, verify, url, stop, start,
    replacePin: (next) => {
      const newPepper = randomBytes(32), newSalt = randomBytes(16);
      const input = createHmac('sha256', newPepper).update(next).digest();
      writeFileSync(hashPath, `${newSalt.toString('hex')}:${scryptSync(input, newSalt, 64).toString('hex')}`);
      writeFileSync(pepperPath, newPepper);
    },
    advance: (ms) => { clock += ms; },
    close: async () => { await stop(); rmSync(directory, { recursive: true, force: true }); } };
}

test('four-digit PIN including leading zero establishes a secure expiring session', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.verify('')).status, 401);
    const result = await f.login();
    assert.equal(result.status, 303);
    const cookie = result.headers.get('set-cookie');
    assert.match(cookie, /Secure; HttpOnly; SameSite=Strict/);
    assert.equal((await f.verify(cookie.split(';')[0])).status, 204);
    f.advance(8 * 60 * 60 * 1000);
    assert.equal((await f.verify(cookie.split(';')[0])).status, 401);
  } finally { await f.close(); }
});

test('root application is opened after PIN and unrelated paths are rejected', async () => {
  const f = await fixture('test', '0007', '/');
  try {
    const result = await f.login();
    assert.equal(result.status, 303);
    assert.equal(result.headers.get('location'), '/');
  } finally { await f.close(); }
  await assert.rejects(() => fixture('test', '0007', '//attacker.example/'), /Invalid application path/);
});

test('malformed values fail and the per-IP limit prevents further attempts', async () => {
  const f = await fixture();
  try {
    for (const value of ['007', '00007', 'abcd', '０００７', '0008']) assert.equal((await f.login(value)).status, 401);
    assert.equal((await f.login()).status, 429);
    assert.equal((await f.login('0007', '192.0.2.2')).status, 303);
    f.advance(15 * 60 * 1000 + 1);
    assert.equal((await f.login()).status, 303);
  } finally { await f.close(); }
});

test('distributed failures and per-IP counts survive restart and expire', async () => {
  const f = await fixture();
  try {
    for (let i = 1; i <= 10; i++) assert.equal((await f.login('1234', `192.0.2.${i}`)).status, 401);
    assert.equal((await f.login('0007', '192.0.2.100')).status, 429);
    await f.stop(); await f.start();
    assert.equal((await f.login('0007', '192.0.2.101')).status, 429);
    f.advance(60 * 60 * 1000 + 1);
    assert.equal((await f.login('0007', '192.0.2.101')).status, 303);
  } finally { await f.close(); }
});

test('simultaneous incorrect attempts cannot exceed the IP limit', async () => {
  const f = await fixture();
  try {
    const results = await Promise.all(Array.from({ length: 10 }, () => f.login('1234')));
    assert.equal(results.filter((r) => r.status === 401).length, 5);
    assert.equal(results.filter((r) => r.status === 429).length, 5);
  } finally { await f.close(); }
});

test('missing persistent state fails closed even for an existing session', async () => {
  const f = await fixture();
  try {
    const session = (await f.login()).headers.get('set-cookie').split(';')[0];
    unlinkSync(f.statePath);
    assert.equal((await f.verify(session)).status, 503);
    assert.equal((await f.login()).status, 503);
  } finally { await f.close(); }
});

test('zone PINs and sessions are independent', async () => {
  const a = await fixture('test', '0007'), b = await fixture('production', '0029');
  try {
    const session = (await a.login()).headers.get('set-cookie').split(';')[0];
    assert.equal((await b.verify(session)).status, 401);
    assert.equal((await b.login('0007')).status, 401);
    assert.equal((await b.login('0029')).status, 303);
  } finally { await a.close(); await b.close(); }
});

test('gate restart revokes previous gate sessions without changing app cookies', async () => {
  const f = await fixture();
  try {
    const session = (await f.login()).headers.get('set-cookie').split(';')[0];
    assert.equal((await f.verify(`${session}; LASTOCHKA_SESSION=synthetic-app-session`)).status, 204);
    await f.stop(); await f.start();
    assert.equal((await f.verify(`${session}; LASTOCHKA_SESSION=synthetic-app-session`)).status, 401);
    const fresh = await f.login();
    assert.equal(fresh.status, 303);
    assert.doesNotMatch(fresh.headers.get('set-cookie'), /LASTOCHKA_SESSION=/);
  } finally { await f.close(); }
});

test('rotating PIN and restarting revokes the old gate session', async () => {
  const f = await fixture();
  try {
    const old = (await f.login()).headers.get('set-cookie').split(';')[0];
    await f.stop(); f.replacePin('0412'); await f.start();
    assert.equal((await f.verify(old)).status, 401);
    assert.equal((await f.login('0007')).status, 401);
    assert.equal((await f.login('0412')).status, 303);
  } finally { await f.close(); }
});

test('origin and CSRF are required and logout revokes the gate session', async () => {
  const f = await fixture();
  try {
    const values = await f.form();
    const fake = await fetch(`${f.url()}/__gate/login`, { method: 'POST', redirect: 'manual',
      headers: { origin: 'https://evil.test', cookie: values.cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: values.csrf, pin: f.pin }) });
    assert.equal(fake.status, 403);
    const session = (await f.login()).headers.get('set-cookie').split(';')[0];
    const logout = await fetch(`${f.url()}/__gate/logout`, { method: 'POST', redirect: 'manual',
      headers: { origin: f.origin, cookie: `${values.cookie}; ${session}; LASTOCHKA_SESSION=fixture`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ csrf: values.csrf }) });
    assert.equal(logout.status, 303);
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    assert.equal((await f.verify(session)).status, 401);
  } finally { await f.close(); }
});

test('opening another form preserves the token and both forms remain usable', async () => {
  const f = await fixture();
  try {
    const first = await f.form();
    const second = await f.form(first.cookie);
    assert.equal(second.csrf, first.csrf);
    assert.equal(second.cookie, first.cookie);
    for (const values of [first, second]) {
      const response = await fetch(`${f.url()}/__gate/login`, { method: 'POST', redirect: 'manual',
        headers: { origin: f.origin, cookie: second.cookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ csrf: values.csrf, pin: f.pin }) });
      assert.equal(response.status, 303);
    }
    const invalid = await f.form('__Host-lastochka_csrf=bad');
    assert.match(invalid.csrf, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(invalid.cookie, '__Host-lastochka_csrf=bad');
  } finally { await f.close(); }
});
