# Покрытие ошибок авторизации и уведомлений

Исходная карта 23.10.2026: известные reason-code из ResponseStatusException;
дополнительные framework/Security-коды покрываются messages.properties.

- `ACCESS_DENIED`
- `AUTH_REQUIRED`
- `BOOKING_UNAVAILABLE`
- `CALENDAR_RANGE_TOO_DENSE`
- `CAPACITY_EXCEEDED`
- `CHILD_ARCHIVED`
- `CHILD_HAS_BOOKINGS`
- `CHILD_SCHEDULE_CONFLICT`
- `CHILD_UNAVAILABLE`
- `CONFIRMATION_CONTEXT_CHANGED`
- `CONFIRMATION_UNAVAILABLE`
- `DUPLICATE_BOOKING`
- `EMAIL_UNVERIFIED`
- `ENROLLMENT_REQUIRED`
- `IDEMPOTENCY_CONFLICT`
- `INVALID_CHALLENGE`
- `INVALID_CREDENTIALS`
- `INVALID_IDEMPOTENCY_KEY`
- `INVALID_PAGE`
- `INVALID_RANGE`
- `INVALID_TOKEN`
- `INVALID_WEBAUTHN`
- `LAST_PASSKEY`
- `MOVE_PREVIEW_STALE`
- `NOT_FOUND`
- `NO_CHANGE`
- `RATE_LIMITED`
- `REASON_REQUIRED`
- `REAUTH_REQUIRED`
- `SCHEDULE_CONFLICT`
- `SESSION_UNAVAILABLE`
- `VALIDATION_ERROR`
- `VERSION_CONFLICT`

Общие входы: ApiExceptionHandler (MVC), authenticationEntryPoint/accessDeniedHandler
(Security до контроллера), локальные client network/WebAuthn/формы.
Foreground: auth submit/verify, children CRUD, booking, calendar/participants/targets,
перенос, resend, WebAuthn, «Приду». Показ ошибки только после проверки актуальности
результата, поэтому общий transport не показывает toast до generation guard.
Фоновый auth refresh, loader prefetch, отменённые/устаревшие ответы — без toast.
Состояния ошибок страниц/полей сохраняются после исчезновения уведомления.
