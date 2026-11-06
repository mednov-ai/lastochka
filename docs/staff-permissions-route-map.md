# Карта доступа к API сотрудников

Рабочая карта для `add-staff-permissions`, составлена по контроллерам и `Metadata`.
Текущая реализация проверяет эту матрицу на сервере; результаты и ограничения — в `staff-permissions.md`.
Пути указаны без серверного context path `/lastochka`.

Миграция V19 отдельно проверена 06.11.2026 на синтетической PostgreSQL 17.6:
backend 0.17.1 создал V18, затем SQL V19 применён вручную. Аккаунт ADMIN,
сессия, тестовый ключ, заявка и оплата сохранились по полям; создание STAFF и
права прошло, неизвестное право и старая роль PARENT отклонены ограничениями БД.
Позднее Flyway и восстановление отдельно проверены на синтетической копии V18; реальная серверная копия и поставка не проверялись.

| Метод и путь | Требуемый доступ |
| --- | --- |
| `GET /api/v1/admin/calendar`, `/admin/sessions`, `/admin/sessions/{id}/draft`, `/admin/sessions/{id}/history` | Просмотр расписания |
| `POST /api/v1/admin/sessions`, `PUT /admin/sessions/{id}`, `POST /admin/sessions/{id}/actions` | Изменение расписания |
| `PUT`, `DELETE /api/v1/admin/sessions/{id}/draft`; `POST /admin/sessions/{id}/draft/publish`, `/admin/sessions/{id}/history/{revisionId}/restore-draft` | Изменение расписания |
| `GET /api/v1/admin/schedule-groups`, `/schedule-groups/{id}/history` | Просмотр расписания |
| `POST /api/v1/admin/schedule-groups`, `PUT /admin/schedule-groups/{id}` | Изменение расписания |
| `GET /api/v1/admin/session-series`, `/session-series/{id}`, `/session-series/calendar`, `/session-series/{id}/history` | Просмотр расписания |
| `POST /api/v1/admin/session-series/preview`, `/new-group/preview`, `/{id}/preview` | Изменение расписания: предпросмотр параметров редактора |
| `POST /api/v1/admin/session-series`, `/new-group`, `/{id}/publish`; `PUT`, `DELETE /admin/session-series/{id}/draft` | Изменение расписания |
| `GET /api/v1/admin/payment-requests`, `/payment-requests/{id}` | Просмотр оплат |
| `POST /api/v1/admin/payment-requests`, `PUT /admin/payment-requests/{id}`, `POST /admin/payment-requests/{id}/issue` | Изменение оплат; выпуск ссылки остаётся отключённым |
| `GET /api/v1/admin/enquiries`, `/enquiries/{id}`, `/enquiries/{id}/delivery`, `/enquiries/{id}/browser-push`; `POST /admin/enquiries/{id}/delivery/retry` | Заявки |
| `GET`, `PUT /api/v1/admin/enquiry-notification-settings` | Только ADMIN |
| `GET /api/v1/admin/browser-push/config`; `POST /admin/browser-push/subscriptions`; `GET`, `DELETE /admin/browser-push/subscriptions/{id}` | Своя подписка допущенного пользователя; принадлежность проверяется отдельно |
| `GET`, `POST /api/v1/admin/users`; `POST /admin/users/{id}/temporary-password`; новые команды прав | Только ADMIN; для изменений — недавнее подтверждение пароля |
| `/api/v1/auth/webauthn/**`, `/api/v1/auth/me`, `/api/v1/auth/change-password`, `/api/v1/auth/password-stage`, `/api/v1/auth/logout`, `/api/v1/auth/csrf` | Действующий пользователь и соответствующие ограничения сессии; собственная безопасность |
| `GET /api/v1/sessions/**`, `/api/v1/public/**`, `POST /api/v1/enquiries` | Публичные маршруты с прежними ограничениями |
| Старые маршруты семей, детей, бронирований, состава и посещений | Прежний контролируемый ответ о снятии; не превращать в доступ STAFF |
| Неизвестные закрытые маршруты | Отказ по умолчанию |

При создании или редактировании черновика с `enquiryId` дополнительно нужен доступ
к заявкам; без него нельзя читать либо подставлять заявку по её идентификатору.
Просмотр сохранённого черновика показывает только собственные сохранённые поля,
не позволяет получить подробности исходной заявки. Проверки CSRF, допуска,
версий, идемпотентности, истории и защиты ограниченной сессии сохраняются.
