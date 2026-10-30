import { uiText } from './ui-texts';
export class UserFacingError extends Error {}
const reported = new WeakSet<object>();
const fallback = uiText.failed;
// Only structured errors from our typed API may supply public text. Never echo Error.message.
export function publicFields(error: unknown): Record<string, string> {
  if (!error || typeof error !== 'object' || !('requestId' in error) || !('fieldErrors' in error))
    return {};
  const fields = error.fieldErrors;
  if (!fields || typeof fields !== 'object') return {};
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([key, value]) =>
        /^[A-Za-z][A-Za-z0-9_.\[\]]{0,99}$/.test(key) &&
        typeof value === 'string' &&
        value.length <= 1000 &&
        !/[<>]/.test(value),
    ),
  );
}
export function normalizeError(error: unknown, legacy: Record<string, string> = {}): string {
  if (error instanceof UserFacingError) return error.message;
  if (error instanceof DOMException && error.name === 'NotAllowedError')
    return 'Подтверждение ключом отменено или время ожидания истекло. Вы можете повторить проверку позже; вход по паролю остаётся доступен.';
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    if (
      'requestId' in error &&
      typeof error.requestId === 'string' &&
      'detail' in error &&
      typeof error.detail === 'string' &&
      error.detail.trim().length > 0 &&
      error.detail.length <= 1000 &&
      !/[<>]/.test(error.detail)
    )
      return error.detail;
    return legacy[error.code] ?? fallback;
  }
  return fallback;
}
export function reportError(error: unknown, text: string): void {
  if (
    typeof window === 'undefined' ||
    (error instanceof DOMException && error.name === 'AbortError')
  )
    return;
  if (error && typeof error === 'object') {
    if (reported.has(error)) return;
    reported.add(error);
  }
  window.dispatchEvent(new CustomEvent('lastochka:error', { detail: text }));
}
