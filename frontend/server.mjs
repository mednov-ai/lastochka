import express from 'express';
import { normalizeBase } from './base-path.mjs';
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequestHandler } from '@react-router/express';
const app = express();
const base = normalizeBase(process.env.APP_BASE_PATH);
app.disable('x-powered-by');
app.set('trust proxy', ['loopback', 'uniquelocal']);
app.set('strict routing', true);
app.use((req, res, next) => {
  if (
    req.path.startsWith(`${base}/admin/`) ||
    req.path.startsWith(`${base}/account/`) ||
    req.path.startsWith(`${base}/auth/`) ||
    req.path.startsWith(`${base}/booking/confirm`) ||
    req.path.startsWith(`${base}/auth/verify`) ||
    req.path.startsWith(`${base}/auth/reset`)
  ) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  }
  next();
});
app.get('/healthz', (_req, res) =>
  res.json({ status: 'UP', version: process.env.APP_VERSION ?? '0.1.0' }),
);
app.get('/readyz', async (_req, res) => {
  try {
    const response = await fetch(
      `${process.env.BACKEND_INTERNAL_URL ?? 'http://127.0.0.1:8080/lastochka'}/api/v1/public/landing`,
      { signal: AbortSignal.timeout(3000) },
    );
    if (!response.ok) throw new Error('Content unavailable');
    const content = await response.json();
    if (!content.revision) throw new Error('Content invalid');
    res.json({
      status: 'UP',
      revision: content.revision,
      version: process.env.APP_VERSION ?? '0.1.0',
    });
  } catch {
    res.status(503).json({ status: 'DOWN' });
  }
});
if (base)
  app.get(base, (req, res) =>
    res.redirect(
      308,
      `${base}/${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`,
    ),
  );
const archive = process.env.ASSET_ARCHIVE_DIR;
if (archive) {
  mkdirSync(join(archive, 'assets'), { recursive: true });
  cpSync('build/client/assets', join(archive, 'assets'), { recursive: true, force: false });
  app.use(
    `${base}/assets`,
    express.static(join(archive, 'assets'), { maxAge: '1y', immutable: true, fallthrough: false }),
  );
}
app.get(`${base}/push-worker.js`, (_req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(join(process.cwd(), 'build/client/push-worker.js'));
});
app.use(base || '/', express.static('build/client', { maxAge: '1h', index: false }));
// Older open tabs discover routes lazily. Ask them to reload into the full route map.
app.get(`${base}/__manifest`, (_req, res) =>
  res.set('Cache-Control', 'no-store').set('X-Remix-Reload-Document', 'true').status(204).end(),
);
app.use((req, res, next) => {
  const routeData = req.path.startsWith(`${base}/`) && req.path.endsWith('.data');
  if (req.path.startsWith(`${base}/api/`) || (/\.[a-z0-9]+$/i.test(req.path) && !routeData)) {
    res.status(404).end();
    return;
  }
  next();
});
app.use(base || '/', createRequestHandler({ build: () => import('./build/server/index.js') }));
const server = app.listen(
  Number(process.env.PORT ?? 3000),
  process.env.BIND_ADDRESS ?? '127.0.0.1',
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
