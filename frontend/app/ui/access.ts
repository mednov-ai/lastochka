import type { components } from '../api/schema';

type Account = components['schemas']['AccountView'];
export type Permission =
  'SCHEDULE_VIEW' | 'SCHEDULE_EDIT' | 'PAYMENT_VIEW' | 'PAYMENT_EDIT' | 'ENQUIRIES_VIEW';

export function can(account: Account | undefined, permission: Permission): boolean {
  if (!account) return false;
  if (account.role === 'ADMIN') return true;
  const permissions = account.permissions ?? [];
  return (
    permissions.includes(permission) ||
    (permission === 'SCHEDULE_VIEW' && permissions.includes('SCHEDULE_EDIT')) ||
    (permission === 'PAYMENT_VIEW' && permissions.includes('PAYMENT_EDIT'))
  );
}

export function firstWorkspace(account: Account | undefined): string {
  if (can(account, 'SCHEDULE_VIEW')) return '/admin/schedule';
  if (can(account, 'ENQUIRIES_VIEW')) return '/admin/requests';
  if (can(account, 'PAYMENT_VIEW')) return '/admin/payments';
  return '/account/security';
}
