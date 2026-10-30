import { test, expect } from '@playwright/test';
import { base, call } from './support/actors';
test('drag only proposes a move; keyboard confirmation saves and can be restored', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const id = '10000000-0000-0000-0000-000000000004';
  const before = await (await page.request.get(base + '/api/v1/sessions/' + id)).json();
  await page.goto(base + '/auth/login');
  await page.getByLabel('Логин', { exact: true }).fill('fixture-admin');
  await page.getByLabel('Пароль', { exact: true }).fill('Fixture-pass-123');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Расписание', exact: true })).toBeVisible();
  await page.getByLabel('Дата', { exact: true }).fill('2026-11-25');
  const source = page.locator(`.calendar-event[data-session-id="${id}"]`);
  await expect(source).toBeVisible();
  await expect(source).toHaveAttribute('draggable', 'true');
  await source.scrollIntoViewIfNeeded();
  const target = page.locator('.time-day[data-day="2026-11-26"]');
  const sourceBox = await source.boundingBox(),
    targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('Calendar geometry is unavailable');
  await source.dragTo(target, {
    targetPosition: { x: 30, y: sourceBox.y + sourceBox.height / 2 - targetBox.y },
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Начало · МСК')).toHaveValue(/^2026-11-26T/);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await (await page.request.get(base + '/api/v1/sessions/' + id)).json()).startsAt).toBe(
    before.startsAt,
  );
  try {
    await source.focus();
    await page.keyboard.press('Enter');
    await page.getByLabel('Начало · МСК').fill('2026-11-25T16:00');
    await page.getByLabel('Окончание · МСК').fill('2026-11-25T17:00');
    await page.getByRole('button', { name: 'Сохранить занятие', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Проверьте изменение занятия' })).toBeVisible();
    await page.getByRole('button', { name: 'Подтвердить изменение', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const changed = await (await page.request.get(base + '/api/v1/sessions/' + id)).json();
    expect(changed.startsAt).not.toBe(before.startsAt);
    expect(changed).not.toHaveProperty('freePlaces');
  } finally {
    const current = await (await page.request.get(base + '/api/v1/sessions/' + id)).json();
    if (current.startsAt !== before.startsAt) {
      const response = await call(
        page,
        'PUT',
        '/admin/sessions/' + id,
        {
          expectedVersion: current.version,
          session: {
            title: before.title,
            format: before.format,
            startsAt: before.startsAt,
            endsAt: before.endsAt,
            capacity: before.capacity,
          },
        },
        crypto.randomUUID(),
      );
      expect(response.ok()).toBe(true);
    }
  }
});
