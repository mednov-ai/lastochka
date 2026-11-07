import { createServer } from 'node:http';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

const SESSION_COOKIE = '__Host-lastochka_gate';
const CSRF_COOKIE = '__Host-lastochka_csrf';
const SESSION_SECONDS = 8 * 60 * 60;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;
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

function readSecrets(passwordHashPath, sessionKeyPath) {
  const passwordHash = readFileSync(passwordHashPath, 'utf8').trim().split(':');
  if (passwordHash.length !== 2 || !/^[0-9a-f]{32}$/.test(passwordHash[0]) || !/^[0-9a-f]{128}$/.test(passwordHash[1])) {
    throw new Error('Invalid password hash file');
  }
  const key = readFileSync(sessionKeyPath);
  if (key.length !== 32) throw new Error('Invalid session key file');
  return { salt: Buffer.from(passwordHash[0], 'hex'), hash: Buffer.from(passwordHash[1], 'hex'), key };
}

export function createGate({ origin, passwordHashPath, sessionKeyPath, placeholderPath, logoPath, now = Date.now }) {
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin || parsedOrigin.protocol !== 'https:') throw new Error('HTTPS origin required');
  const { salt, hash, key } = readSecrets(passwordHashPath, sessionKeyPath);
  const placeholder = readFileSync(placeholderPath, 'utf8');
  if (!placeholder.includes('{{CSRF_TOKEN}}')) throw new Error('Missing CSRF placeholder');
  const logo = readFileSync(logoPath);
  const failures = new Map();
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

  function allowed(ip) {
    const current = now();
    for (const [key, entry] of failures) if (current - entry.start >= RATE_WINDOW_MS) failures.delete(key);
    const entry = failures.get(ip);
    return entry ? entry.count < MAX_FAILURES : failures.size < MAX_CLIENTS;
  }

  function fail(ip) {
    const entry = failures.get(ip) ?? { start: now(), count: 0 };
    entry.count += 1;
    failures.set(ip, entry);
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

  return createServer((req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    if (!cookies) return respond(res, 400);
    let url;
    try { url = new URL(req.url, origin); } catch { return respond(res, 400); }
    if (url.origin !== origin) return respond(res, 400);
    if (url.search) return respond(res, 400);
    if (req.method === 'GET' && url.pathname === '/__gate/verify') {
      return respond(res, validSession(cookies[SESSION_COOKIE]) ? 204 : 401);
    }
    if (req.method === 'GET' && url.pathname === '/__gate/logo.svg') {
      return respond(res, 200, logo, { 'Content-Type': 'image/svg+xml' });
    }
    if (req.method === 'GET' && url.pathname === '/__gate/') {
      const csrf = randomBytes(32).toString('base64url');
      const logout = validSession(cookies[SESSION_COOKIE])
        ? `<form method="post" action="/__gate/logout"><input type="hidden" name="csrf" value="${csrf}"><a href="/lastochka/">Вернуться на сайт</a><br><button class="submit" type="submit">Закрыть доступ</button></form>`
        : '';
      return respond(res, 200, placeholder.replace('{{CSRF_TOKEN}}', csrf).replace('<!--GATE_LOGOUT-->', logout), {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        'Set-Cookie': `${CSRF_COOKIE}=${csrf}; ${cookieOptions}; Max-Age=3600`,
      });
    }
    if (req.method !== 'POST' || !['/__gate/login', '/__gate/logout'].includes(url.pathname)) return respond(res, 404);
    if (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) return respond(res, 403);
    const ip = clientIp(req);
    if (!allowed(ip)) return respond(res, 429, 'Слишком много попыток. Повторите позже.');
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
      const passwords = fields.getAll('password');
      if (passwords.length !== 1 || Buffer.byteLength(passwords[0]) > 256 || !timingSafeEqual(scryptSync(passwords[0], salt, 64), hash)) {
        fail(ip);
        return respond(res, 401, 'Неверный пароль. Вернитесь назад и повторите попытку.', { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      failures.delete(ip);
      const current = Math.floor(now() / 1000);
      for (const [session, expires] of sessions) if (expires <= current) sessions.delete(session);
      if (sessions.size >= MAX_CLIENTS) return respond(res, 503, 'Попробуйте войти позднее.');
      const expiry = Math.floor(now() / 1000) + SESSION_SECONDS;
      const payload = `${expiry}.${randomBytes(16).toString('base64url')}`;
      const session = `${payload}.${sign(payload)}`;
      sessions.set(session, expiry);
      return respond(res, 303, '', {
        Location: '/lastochka/',
        'Set-Cookie': `${SESSION_COOKIE}=${session}; ${cookieOptions}; Max-Age=${SESSION_SECONDS}`,
      });
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createGate({
    origin: process.env.GATE_ORIGIN,
    passwordHashPath: process.env.GATE_PASSWORD_HASH_FILE,
    sessionKeyPath: process.env.GATE_SESSION_KEY_FILE,
    placeholderPath: process.env.GATE_PLACEHOLDER_FILE,
    logoPath: process.env.GATE_LOGO_FILE,
  });
  server.listen(Number(process.env.PORT || 3001), '0.0.0.0');
}
