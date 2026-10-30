import type { Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
export const base = (process.env.TEST_APP_URL ?? 'http://localhost:5173/lastochka').replace(
  /\/$/,
  '',
);
export async function call(page: Page, method: string, path: string, body?: unknown, key?: string) {
  const c = await (await page.request.get(base + '/api/v1/auth/csrf')).json();
  return page.request.fetch(base + '/api/v1' + path, {
    method,
    data: body,
    headers: { [c.headerName]: c.token, ...(key ? { 'Idempotency-Key': key } : {}) },
  });
}
