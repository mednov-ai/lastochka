import { createServer } from 'node:http';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { openRateStore } from './rate-store.mjs';

const SESSION_COOKIE = '__Host-lastochka_gate';
const CSRF_COOKIE = '__Host-lastochka_csrf';
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_CLIENTS = 10000;
const MAX_BODY = 4096;
const cookieOptions = 'Path=/; Secure; HttpOnly; SameSite=Strict';

function parseCookies(header = '') {
  const result = Object.create(null);
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (Object.hasOwn(result, key)) return null;
    result[key] = part.slice(index + 1).trim();
  }
  return result;
}

function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readSecrets(passwordHashPath, sessionKeyPath, pepperPath) {
  function privateFile(path) {
    const info = lstatSync(path);
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600 || info.size > 1024) {
      throw new Error('Unprotected gate secret');
    }
    return readFileSync(path);
  }
  const passwordHash = privateFile(passwordHashPath).toString('utf8').trim().split(':');
  if (passwordHash.length !== 2 || !/^[0-9a-f]{32}$/.test(passwordHash[0]) || !/^[0-9a-f]{128}$/.test(passwordHash[1])) {
    throw new Error('Invalid password hash file');
  }
  const key = privateFile(sessionKeyPath);
  const pepper = privateFile(pepperPath);
  if (key.length !== 32 || pepper.length !== 32) throw new Error('Invalid gate key file');
  return { salt: Buffer.from(passwordHash[0], 'hex'), hash: Buffer.from(passwordHash[1], 'hex'), key, pepper };
}

export function createGate({ origin, zone, passwordHashPath, sessionKeyPath, pepperPath, statePath, placeholderPath, logoPath, appPath = '/lastochka/', now = Date.now }) {
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin || parsedOrigin.protocol !== 'https:') throw new Error('HTTPS origin required');
  if (!['/', '/lastochka/'].includes(appPath)) throw new Error('Invalid application path');
  const { salt, hash, key, pepper } = readSecrets(passwordHashPath, sessionKeyPath, pepperPath);
  const placeholder = readFileSync(placeholderPath, 'utf8');
  if (!placeholder.includes('{{CSRF_TOKEN}}')) throw new Error('Missing CSRF placeholder');
  const logo = readFileSync(logoPath);
  const rateStore = openRateStore(statePath, zone, pepper, now);
  const sessions = new Map();

  function sign(payload) {
    return createHmac('sha256', key).update(payload).digest('base64url');
  }

  function validSession(value) {
    if (!value || value.length > 256) return false;
    const parts = value.split('.');
    if (parts.length !== 3 || !/^\d{1,12}$/.test(parts[0]) || !/^[A-Za-z0-9_-]{22}$/.test(parts[1])) return false;
    const expires = Number(parts[0]);
    return expires > Math.floor(now() / 1000) && expires <= Math.floor(now() / 1000) + SESSION_SECONDS && sessions.get(value) === expires && equal(parts[2], sign(`${parts[0]}.${parts[1]}`));
  }

  function clientIp(req) {
    const ip = req.headers['x-real-ip'];
    return typeof ip === 'string' && isIP(ip) ? ip : req.socket.remoteAddress;
  }

  function respond(res, status, body = '', headers = {}) {
    res.writeHead(status, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      ...headers,
    });
    res.end(body);
  }

  const server = createServer((req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    if (!cookies) return respond(res, 400);
    let url;
    try { url = new URL(req.url, origin); } catch { return respond(res, 400); }
    if (url.origin !== origin) return respond(res, 400);
    if (url.search) return respond(res, 400);
    if (req.method === 'GET' && url.pathname === '/__gate/verify') {
      try { rateStore.check(); return respond(res, validSession(cookies[SESSION_COOKIE]) ? 204 : 401); }
      catch { return respond(res, 503); }
    }
    if (req.method === 'GET' && url.pathname === '/__gate/logo.svg') {
      return respond(res, 200, logo, { 'Content-Type': 'image/svg+xml' });
    }
    if (req.method === 'GET' && url.pathname === '/__gate/') {
      // Keep the same unpredictable token across tabs for the lifetime of the
      // host-only cookie, so opening another form cannot invalidate this one.
      const csrf = /^[A-Za-z0-9_-]{43}$/.test(cookies[CSRF_COOKIE] ?? '')
        ? cookies[CSRF_COOKIE]
        : randomBytes(32).toString('base64url');
      const logout = validSession(cookies[SESSION_COOKIE])
        ? `<form method="post" action="/__gate/logout"><input type="hidden" name="csrf" value="${csrf}"><a href="${appPath}">Вернуться на сайт</a><br><button class="submit" type="submit">Закрыть доступ</button></form>`
        : '';
      return respond(res, 200, placeholder.replace('{{CSRF_TOKEN}}', csrf).replace('<!--GATE_LOGOUT-->', logout), {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        'Set-Cookie': `${CSRF_COOKIE}=${csrf}; ${cookieOptions}; Max-Age=3600`,
      });
    }
    if (req.method !== 'POST' || !['/__gate/login', '/__gate/logout'].includes(url.pathname)) return respond(res, 404);
    if (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) return respond(res, 403);
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY) req.destroy();
    });
    req.on('end', () => {
      if (Buffer.byteLength(body) > MAX_BODY) return;
      const fields = new URLSearchParams(body);
      if (fields.getAll('csrf').length !== 1 || !equal(fields.get('csrf'), cookies[CSRF_COOKIE])) return respond(res, 403);
      if (url.pathname === '/__gate/logout') {
        sessions.delete(cookies[SESSION_COOKIE]);
        return respond(res, 303, '', { Location: '/__gate/', 'Set-Cookie': `${SESSION_COOKIE}=; ${cookieOptions}; Max-Age=0` });
      }
      const pins = fields.getAll('pin');
      let outcome;
      try {
        outcome = rateStore.attempt(clientIp(req), () => {
          const valid = pins.length === 1 && /^[0-9]{4}$/.test(pins[0]);
          const candidate = valid ? pins[0] : '0000';
          const keyed = createHmac('sha256', pepper).update(candidate).digest();
          return timingSafeEqual(scryptSync(keyed, salt, 64), hash) && valid;
        });
      } catch { return respond(res, 503, 'Проверка временно недоступна.', { 'Content-Type': 'text/plain; charset=utf-8' }); }
      if (outcome === 'blocked') return respond(res, 429, 'Слишком много попыток. Повторите позже.', { 'Content-Type': 'text/plain; charset=utf-8' });
      if (outcome !== 'accepted') return respond(res, 401, 'Неверный PIN. Вернитесь назад и повторите попытку.', { 'Content-Type': 'text/plain; charset=utf-8' });
      const current = Math.floor(now() / 1000);
      for (const [session, expires] of sessions) if (expires <= current) sessions.delete(session);
      if (sessions.size >= MAX_CLIENTS) return respond(res, 503, 'Попробуйте войти позднее.');
      const expiry = Math.floor(now() / 1000) + SESSION_SECONDS;
      const payload = `${expiry}.${randomBytes(16).toString('base64url')}`;
      const session = `${payload}.${sign(payload)}`;
      sessions.set(session, expiry);
      return respond(res, 303, '', {
        Location: appPath,
        'Set-Cookie': `${SESSION_COOKIE}=${session}; ${cookieOptions}; Max-Age=${SESSION_SECONDS}`,
      });
    });
  });
  server.on('close', () => rateStore.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createGate({
    origin: process.env.GATE_ORIGIN,
    zone: process.env.GATE_ZONE,
    passwordHashPath: process.env.GATE_PASSWORD_HASH_FILE,
    sessionKeyPath: process.env.GATE_SESSION_KEY_FILE,
    pepperPath: process.env.GATE_PEPPER_FILE,
    statePath: process.env.GATE_RATE_STATE_FILE,
    placeholderPath: process.env.GATE_PLACEHOLDER_FILE,
    logoPath: process.env.GATE_LOGO_FILE,
    appPath: process.env.GATE_APP_PATH || '/lastochka/',
  });
  server.listen(Number(process.env.PORT || 3001), '0.0.0.0');
}
