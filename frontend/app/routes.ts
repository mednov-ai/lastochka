import { type RouteConfig, index, route } from '@react-router/dev/routes';
export default [
  index('routes/home.tsx'),
  route('enquiry', 'routes/enquiry.tsx'),
  route('auth/:action', 'routes/auth.tsx'),
  route('account/change-password', 'routes/change-password.tsx'),
  route('admin/users', 'routes/users.tsx'),
  route('account/security', 'routes/security.tsx'),
  route('payments/test/return', 'routes/payment-test-return.tsx'),
  route('admin/:section', 'routes/admin.tsx'),
  route('account/*', 'routes/legacy.tsx', { id: 'legacy-account' }),
  route('booking/confirm', 'routes/legacy.tsx', { id: 'legacy-confirmation' }),
] satisfies RouteConfig;
