import { calendarFetch } from '../ui/editor-commands';
import { uiText } from '../ui/ui-texts';
import { UserFacingError, normalizeError, reportError, publicFields } from '../ui/error-feedback';
import createClient from 'openapi-fetch';
import type { paths } from './schema';
export const api = createClient<paths>({
  baseUrl: import.meta.env.BASE_URL.replace(/\/$/, ''),
  credentials: 'same-origin',
  fetch: (request) =>
    calendarFetch(request, async (request) => {
      try {
        if (new URL(request.url).pathname.includes('/api/v1/admin/payment-requests'))
          request.headers.set('X-Lastochka-Payment-Contract', '2');
        const response = await fetch(request);
        if (!response.ok && !response.headers.get('Content-Type')?.includes('json'))
          throw new Error('Unstructured response');
        return response;
      } catch (error) {
        if (request.signal.aborted) throw error;
        return new Response(
          JSON.stringify({
            type: 'about:blank',
            title: 'Сервис недоступен',
            status: 503,
            code: 'SERVICE_UNAVAILABLE',
            detail: uiText.unavailable,
            requestId: 'network',
            fieldErrors: {},
          }),
          { status: 503, headers: { 'Content-Type': 'application/problem+json' } },
        );
      }
    }),
});
api.use({
  async onResponse({ request, response }) {
    if (typeof window !== 'undefined') {
      const path = new URL(request.url, window.location.href).pathname;
      if (
        (path.endsWith('/auth/logout') && response.ok) ||
        (path.endsWith('/auth/reset-password') && response.ok) ||
        (path.endsWith('/auth/change-password') && response.ok)
      )
        window.dispatchEvent(new Event('lastochka:auth-changed'));
      else if (
        !path.endsWith('/auth/me') &&
        ((response.status === 401 && !path.endsWith('/auth/password-stage')) ||
          response.status === 403)
      ) {
        const body = await response
          .clone()
          .json()
          .catch(() => null);
        if (
          body?.code !== 'REAUTH_REQUIRED' &&
          !(path.endsWith('/auth/password-confirmation') && body?.code === 'INVALID_CREDENTIALS') &&
          !(
            path.endsWith('/auth/password-confirmation') &&
            response.status === 403 &&
            body?.code === 'ACCESS_DENIED'
          )
        )
          window.dispatchEvent(new Event('lastochka:session-expired'));
      }
    }
  },
});
export async function csrf(): Promise<Record<string, string>> {
  const { data, error } = await api.GET('/api/v1/auth/csrf');
  if (error) throw error;
  if (!data) throw new UserFacingError(uiText.csrf);
  return { [data.headerName]: data.token };
}
export function message(error: unknown): string {
  const codes: Record<string, string> = {
    SERVICE_UNAVAILABLE: uiText.unavailable,
    SESSION_UNAVAILABLE: 'Занятие закрыто, отменено или уже началось.',
    BOOKING_UNAVAILABLE: 'Эту запись уже нельзя изменить.',
    CHILD_ARCHIVED: 'Карточка ребёнка в архиве.',
    CHILD_HAS_BOOKINGS: 'Сначала отмените или перенесите будущие записи ребёнка.',
    DUPLICATE_BOOKING: 'Ребёнок уже записан на это занятие.',
    CHILD_SCHEDULE_CONFLICT: 'У ребёнка уже есть занятие в это время.',
    REASON_REQUIRED: 'Укажите причину отмены или отклонения.',
    CAPACITY_EXCEEDED: 'Свободные места закончились. Выберите другое занятие.',
    VERSION_CONFLICT: 'Данные изменились. Обновите страницу и повторите действие.',
    CALENDAR_RANGE_TOO_DENSE:
      'В этом периоде слишком много занятий. Выберите режим «День» или другую дату.',
    MOVE_PREVIEW_STALE:
      'Расписание или состав изменились. Откройте запись заново и проверьте перенос.',
    NO_CHANGE: 'Выберите другое время занятия.',
    CONFIRMATION_UNAVAILABLE:
      'Ссылка недействительна или её срок истёк. Обратитесь к администратору за актуальным письмом.',
    CONFIRMATION_CONTEXT_CHANGED:
      'В другой вкладке открыта другая запись. Откройте нужную ссылку из письма заново.',
    INVALID_CREDENTIALS: uiText.credentials,
    INVALID_TOKEN: 'Ссылка недействительна или истекла. Запросите новую.',
    RATE_LIMITED: 'Слишком много попыток. Повторите позже.',
    REAUTH_REQUIRED: 'Подтверждение пароля истекло. Проверьте состояние действия и повторите его.',
    LAST_ADMIN_REQUIRED: 'Должен оставаться хотя бы один администратор.',
    LAST_PASSKEY: 'Последний ключ удалить нельзя. Сначала добавьте запасной.',
    INVALID_WEBAUTHN: 'Не удалось подтвердить ключ. Повторите вход.',
    SCHEDULE_CONFLICT: 'Это время уже занято другим занятием.',
    SERIES_START_PASSED:
      'Начало занятия уже наступило. Вернитесь к параметрам и измените дату или время, затем проверьте расписание снова.',
    SERIES_BEFORE_CURRENT_WEEK:
      'Дата занятия раньше текущей недели по Москве. Измените начальную дату и проверьте расписание снова.',
  };
  const detail = normalizeError(error, codes);
  const text = [
    detail,
    ...new Set(Object.values(publicFields(error)).filter((value) => !detail.includes(value))),
  ].join(' ');
  reportError(error, text);
  return text;
}

export function option<T extends string>(value: unknown, allowed: readonly T[]): T {
  const selected = allowed.find((item) => item === value);
  if (selected === undefined) throw new UserFacingError('Выберите допустимое действие.');
  return selected;
}
