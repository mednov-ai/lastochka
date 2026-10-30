# Исходный снимок JDBC-доступа

Снимок 30.10.2026 выполнен до первого коммита. Исходное состояние проекта зафиксировано коммитом `3f00640` ветки `main`; хеши ниже относятся к файлам рабочей копии на момент снимка.

Максимальная локальная миграция: V18. Состояние сервера и базы отдельно не проверялось. Список получен поиском JDBC-типов, SQL-вызовов и java.sql в production Kotlin; требуется ручная проверка SQL, сценариев и тестов до закрытия задачи 1.1.

Интеграция библиотеки: identity/config/IdentityConfiguration.kt подключает JDBC-репозитории Spring Security WebAuthn; Spring Session использует свою реализацию. Собственный SessionRevocationRepository отдельно входит в перевод.

## Файлы и операции

### `backend/common/src/main/kotlin/ru/lastochka/common/repo/CommandRepository.kt`
- SHA-256: `5b95c2e5ba1a8b7d428cd434681da518fbd9381c9d00be3d9535164b131dc37a`
- Вызовов `.sql(...)`: 4
- Объявленные функции: lockStudio, findReplay, saveReplay, appendAudit.

### `backend/content/src/main/kotlin/ru/lastochka/content/repo/LandingContentRepository.kt`
- SHA-256: `7e8626757c7ca67312afacc1e1fb5ad977d47ad045024598e1e0728afadab625`
- Вызовов `.sql(...)`: 1
- Объявленные функции: publishedPayload.

### `backend/enquiries/src/main/kotlin/ru/lastochka/enquiries/repo/EnquiryRepository.kt`
- SHA-256: `4df99ffa8e281fb2bca9280c82b58088b5a6142774c8a57055bf7edfdfec6865`
- Вызовов `.sql(...)`: 7
- Объявленные функции: replay, lock, insert, saveReplay, map, find, page.

### `backend/identity/src/main/kotlin/ru/lastochka/identity/config/IdentityConfiguration.kt`
- SHA-256: `7385afe1184fb0f5d00b3f161f9467302a4340216843fd4374747a7933425b8b`
- Вызовов `.sql(...)`: 0
- Объявленные функции: userDetailsService, relyingParty.

### `backend/identity/src/main/kotlin/ru/lastochka/identity/repo/AccountLockRepository.kt`
- SHA-256: `e2dda6b59bc43ae114b028e344931ef6cdafaa0a41fb00cdfae411b2f3b06677`
- Вызовов `.sql(...)`: 2
- Объявленные функции: lock, authVersion.

### `backend/identity/src/main/kotlin/ru/lastochka/identity/repo/AdminAccessRepository.kt`
- SHA-256: `732b6b58f1c3264f3729b3848c79afd907a9ae77ee4ec4692a084d1b66c4954b`
- Вызовов `.sql(...)`: 3
- Объявленные функции: provision, reset, revokeChallenges.

### `backend/identity/src/main/kotlin/ru/lastochka/identity/repo/ChallengeRepository.kt`
- SHA-256: `a38ea4f0d7123eac353dbf1778664fd3df4cb2bd7ff9f76c2fd0d2204f12a109`
- Вызовов `.sql(...)`: 2
- Объявленные функции: save, consume.

### `backend/identity/src/main/kotlin/ru/lastochka/identity/repo/ConceptRepository.kt`
- SHA-256: `893fa9b76c7928e215e766b7b209213d2c77001bad7857f73444f17c849996d7`
- Вызовов `.sql(...)`: 1
- Объявленные функции: mode.

### `backend/identity/src/main/kotlin/ru/lastochka/identity/repo/RateLimitRepository.kt`
- SHA-256: `24907722739c48cf412f5f30b256aa7382b11a6a4f988064cd45c5be8db0c444`
- Вызовов `.sql(...)`: 1
- Объявленные функции: increment.

### `backend/identity/src/main/kotlin/ru/lastochka/identity/repo/SessionRevocationRepository.kt`
- SHA-256: `ad5e2caf090da6c2398c5f59b3513b3d8da38d5269d1236eebe943c375bbe4ab`
- Вызовов `.sql(...)`: 1
- Объявленные функции: revokeSessions.

### `backend/identity/src/main/kotlin/ru/lastochka/identity/repo/UserPasswordRepository.kt`
- SHA-256: `5ca44e274d871eb91a379220856c6331d9fd5eb1de6eb551921ef20204238621`
- Вызовов `.sql(...)`: 8
- Объявленные функции: account, find, findPrincipal, lock, list, count, create, password, revokeChallenges, view.

### `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/NotificationRoutesRepository.kt`
- SHA-256: `f57a685721eb6ee8f7c6ffe23993b7c6bf53104c2dc5aab19f101114271f9092`
- Вызовов `.sql(...)`: 6
- Объявленные функции: record, targets, enqueue, deactivate, count, summary.

### `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/NotificationSettingsRepository.kt`
- SHA-256: `352c0956e7e6e3d2636084800b841e066c4316f936e95bfed9f3bb6dbd26ffce`
- Вызовов `.sql(...)`: 2
- Объявленные функции: get, update.

### `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/PushOutboxRepository.kt`
- SHA-256: `80dd22f80c6ed33b379db03196db9ef33d1c5bf6f45f587a1414640c7a228776`
- Вызовов `.sql(...)`: 8
- Объявленные функции: retireStale, claim, stillActive, finish, deactivate.

### `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/PushSubscriptionRepository.kt`
- SHA-256: `785a808550f1cc0aa2781ba625acd440d0779096c292cee4815b9fc1bf42afa5`
- Вызовов `.sql(...)`: 3
- Объявленные функции: save, deactivate, active.

### `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/TelegramRepository.kt`
- SHA-256: `bce79e75992ef1ab6db71bd7d671be2eded29385e0a85f93e1e9122b4b61d0ac`
- Вызовов `.sql(...)`: 6
- Объявленные функции: enqueue, claim, finish, view, retry.

### `backend/payments/src/main/kotlin/ru/lastochka/payments/repo/PaymentRepository.kt`
- SHA-256: `0b0057bb83b94502d5915db78835d1acaeaaa6bc20a748d3b6cc66f2883bb7f2`
- Вызовов `.sql(...)`: 4
- Объявленные функции: map, find, save, page.

### `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/RecurrenceRepository.kt`
- SHA-256: `e8b3a4216b8b56c267fb43e1fd7aa4c29ef8e15e309d5dba54189f356ade43c4`
- Вызовов `.sql(...)`: 17
- Объявленные функции: groups, group, saveGroup, series, series, saveDraft, discard, publish, memberships, link, unlink, touch, busyIds, draftIds, history, audit.

### `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/SessionDraftRepository.kt`
- SHA-256: `791ef2752d245ba4fb08fe404ad888fc9f51c8608508b2c97777604fe4294561`
- Вызовов `.sql(...)`: 6
- Объявленные функции: find, save, delete, parameters, history, revision.

### `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/SessionQueryRepository.kt`
- SHA-256: `22c49212c1a49b589bd53f4623e2a6df8ebcc4f094f0d1fb6994d8bd2154f34b`
- Вызовов `.sql(...)`: 4
- Объявленные функции: calendarIds, countOverlaps, findPage.

## Покрытие и ограничения

Интеграционные PostgreSQL/Testcontainers тесты находятся в backend/app/src/test/kotlin/ru/lastochka/integration. Соответствие каждой операции вызывающим сценариям и тестам, список таблиц и сравнение результатов ещё не установлены; этот снимок не означает завершения инвентаризации.

## Начальная проверка

- Частичный этап content: `LandingContentRepository.publishedPayload` переведён на JPQL и JPA JSONB mapping; content подключает Spring Data JPA. На отдельном PostgreSQL 17.6 целевой тест сравнил разобранный JSON с исходным SQL; сборка backend и 31 исходный сценарий AdminConcept прошли. Прочие простые операции ещё не завершены, поэтому задача 2.2 остаётся открытой.

- Дополнение: отсутствие landing-записи проверено в изолированной транзакции; прежний JDBC и JPA выбрасывают `EmptyResultDataAccessException`. Маркер `concept_state` переведён на JPQL; в PostgreSQL проверены совпадение значения, отсутствие строки, запуск приложения и отказ при неверном маркере. `:app:test` для `JpaPostgresNativeFeasibilityTest` и `AdminConceptIntegrationTest`, `:app:bootJar` и архитектурная проверка прошли. Остальные простые операции и защитный контроль остаются открытыми.

- Частичный этап identity: собственный отзыв сессий переведён на JPQL bulk delete, библиотека Spring Session сохранена. JPA-сопоставление `CHAR(36)` проверено с `ddl-auto: validate`. На PostgreSQL проверены сохранение выбранной сессии и чужого пользователя, удаление атрибутов по FK и отзыв всех сессий при null; прошли `JpaPostgresNativeFeasibilityTest`, `PasswordLifecycleIntegrationTest`, `:app:bootJar` и действующая архитектурная проверка. Первая проверка выявила неверный JDBC-тип `CHAR`, он исправлен и повторная проверка прошла. На момент этой проверки задача 3.5 оставалась открытой: challenge и ограничения попыток ещё не были переведены.

- Дополнение: операции challenge переведены на Spring Data native queries с атомарными upsert и DELETE RETURNING. На PostgreSQL проверены замена challenge и две конкурирующие транзакции потребления: ровно одна получила новую запись. Проверки `JpaPostgresNativeFeasibilityTest`, `PasswordLifecycleIntegrationTest`, архитектурный контроль и сборка JAR прошли. Проверка прежних WebAuthn-данных и полная приёмка задачи 3.5 остаются открытыми.

- На PostgreSQL 17.6, Hibernate и Spring текущего проекта интеграционный `JpaPostgresNativeFeasibilityTest` проверил параметризованные нативные запросы через JPA `EntityManager`: upsert с `RETURNING`, удаление с `RETURNING`, CTE с `FOR UPDATE SKIP LOCKED` и advisory transaction lock. Тест прошёл; это проверка исполнимости на упрощённой временной таблице, а не проверка конкуренции реальных очередей. Их собственные конкурентные сценарии остаются обязательными.

- 30.10.2026: `:app:test --tests ru.lastochka.integration.AdminConceptIntegrationTest` с Java 25 и отдельным PostgreSQL Testcontainers: тестов 31, ошибок 0, отказов 0, пропущено 0. Это частичная регрессия; эталон по всем операциям и количеству запросов ещё не собран.

## Предварительные точки вызова и тесты

Связи получены текстовым поиском имени класса; косвенные и общие сценарии требуют ручной проверки.

- `CommandRepository`: production: `backend/common/src/main/kotlin/ru/lastochka/common/service/CommandService.kt`; прямые тестовые ссылки: не найдены по имени.
- `LandingContentRepository`: production: `backend/content/src/main/kotlin/ru/lastochka/content/service/LandingContentService.kt`; прямые тестовые ссылки: не найдены по имени.
- `EnquiryRepository`: production: `backend/enquiries/src/main/kotlin/ru/lastochka/enquiries/service/EnquiryService.kt`; прямые тестовые ссылки: не найдены по имени.
- `AccountLockRepository`: production: `backend/identity/src/main/kotlin/ru/lastochka/identity/service/PasskeyService.kt`; прямые тестовые ссылки: не найдены по имени.
- `AdminAccessRepository`: production: `backend/identity/src/main/kotlin/ru/lastochka/identity/service/AdminAccessService.kt`; прямые тестовые ссылки: не найдены по имени.
- `ChallengeRepository`: production: `backend/identity/src/main/kotlin/ru/lastochka/identity/service/ChallengeStore.kt`; прямые тестовые ссылки: не найдены по имени.
- `ConceptRepository`: production: `backend/identity/src/main/kotlin/ru/lastochka/identity/config/ConceptGuard.kt`; прямые тестовые ссылки: `backend/app/src/test/kotlin/ru/lastochka/integration/AdminConceptIntegrationTest.kt`.
- `RateLimitRepository`: production: `backend/identity/src/main/kotlin/ru/lastochka/identity/service/AuthRateLimiter.kt`; прямые тестовые ссылки: не найдены по имени.
- `SessionRevocationRepository`: production: `backend/identity/src/main/kotlin/ru/lastochka/identity/service/PasswordLifecycleService.kt`, `backend/identity/src/main/kotlin/ru/lastochka/identity/service/PasskeyService.kt`; прямые тестовые ссылки: не найдены по имени.
- `UserPasswordRepository`: production: `backend/identity/src/main/kotlin/ru/lastochka/identity/security/PasswordCommandGuard.kt`, `backend/identity/src/main/kotlin/ru/lastochka/identity/service/PasswordLifecycleService.kt`, `backend/identity/src/main/kotlin/ru/lastochka/identity/service/AdminAccessService.kt`, `backend/identity/src/main/kotlin/ru/lastochka/identity/service/UserManagementService.kt`; прямые тестовые ссылки: `backend/app/src/test/kotlin/ru/lastochka/integration/PasswordLifecycleIntegrationTest.kt`.
- `NotificationRoutesRepository`: production: `backend/notifications/src/main/kotlin/ru/lastochka/notifications/service/NotificationRoutes.kt`; прямые тестовые ссылки: `backend/app/src/test/kotlin/ru/lastochka/integration/AdminConceptIntegrationTest.kt`.
- `NotificationSettingsRepository`: production: `backend/notifications/src/main/kotlin/ru/lastochka/notifications/service/NotificationSettingsService.kt`; прямые тестовые ссылки: не найдены по имени.
- `PushOutboxRepository`: production: `backend/notifications/src/main/kotlin/ru/lastochka/notifications/service/PushQueue.kt`; прямые тестовые ссылки: `backend/app/src/test/kotlin/ru/lastochka/integration/AdminConceptIntegrationTest.kt`.
- `PushSubscriptionRepository`: production: `backend/notifications/src/main/kotlin/ru/lastochka/notifications/service/PushSubscriptions.kt`; прямые тестовые ссылки: `backend/app/src/test/kotlin/ru/lastochka/integration/AdminConceptIntegrationTest.kt`.
- `TelegramRepository`: production: `backend/notifications/src/main/kotlin/ru/lastochka/notifications/service/TelegramQueue.kt`; прямые тестовые ссылки: `backend/app/src/test/kotlin/ru/lastochka/integration/AdminConceptIntegrationTest.kt`.
- `PaymentRepository`: production: `backend/payments/src/main/kotlin/ru/lastochka/payments/service/PaymentService.kt`; прямые тестовые ссылки: не найдены по имени.
- `RecurrenceRepository`: production: `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/service/SessionEditorService.kt`, `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/service/RecurrenceService.kt`, `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/service/SchedulingService.kt`; прямые тестовые ссылки: не найдены по имени.
- `SessionDraftRepository`: production: `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/service/SessionEditorService.kt`; прямые тестовые ссылки: не найдены по имени.
- `SessionQueryRepository`: production: `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/service/SchedulingService.kt`; прямые тестовые ссылки: не найдены по имени.

- Исходный коммит `3f00640`: `backend/gradlew -p backend check :app:bootJar --console=plain` с Java 25 завершился успешно. XML-результаты: 95 тестов, 0 отказов, 0 ошибок, 0 пропущено; часть задач сборки использовала актуальные результаты Gradle. Это ещё не полное сравнение эталона и количества запросов.

- Счётчик `auth_limits` переведён на Spring Data `@Query(nativeQuery = true)` с прежним атомарным upsert и RETURNING. На PostgreSQL 17.6 проверены 20 независимых конкурентных транзакций (все результаты от 1 до 20 без потерь), сброс на границе окна и сценарии смены пароля. `JpaPostgresNativeFeasibilityTest`, `PasswordLifecycleIntegrationTest`, архитектурная проверка и bootJar прошли. Задача 3.5 остаётся открытой из-за challenge и итоговых проверок безопасности.

- Блокировка аккаунта и чтение версии переведены на JPQL с PESSIMISTIC_WRITE. На PostgreSQL проверены значение версии и блокировка конкурентного UPDATE независимой транзакцией. Целевые тесты JPA, сценарии паролей, архитектурная проверка и bootJar прошли; остальные операции аккаунтов и passkey требуют проверки.

- `AdminAccessRepository` переведён на JPQL bulk-операции. На PostgreSQL прошли сценарии `AdminConceptIntegrationTest` и `PasswordLifecycleIntegrationTest`, включая назначение и повтор назначения логина; архитектурная проверка и bootJar прошли. Задача 3.4 остаётся открытой до перевода остальных операций аккаунта и проверки семантики bulk-обновлений.

- Настройки уведомлений переведены на Spring Data JPA: выборка и обновление через JPQL, блокируемый снимок через PostgreSQL FOR SHARE. На PostgreSQL проверены конкурентная блокировка, успешное обновление, отклонение устаревшей версии и чтение после bulk update; прошли сценарии AdminConcept и целевые JPA-тесты, архитектурная проверка и bootJar. Во время завершения тестового приложения фоновая очистка Spring Session прервалась при закрытии пула; тесты завершились успешно. Задача 4.1 остаётся открытой до переноса маршрутов и подписок.

- Подписки browser push переведены на Spring Data: параметризованный native upsert с RETURNING сохраняет ограничение владельца, поиск и отключение используют JPA. После добавления транзакции для отключения все 31 сценарий AdminConcept прошли на PostgreSQL. Первая попытка выявила требование JPA к транзакции; повторная проверка прошла. Перевод маршрутов и полная задача 4.1 остаются открытыми.

## Инвентаризация исходного коммита 3f00640

В таблице перечислены методы JDBC-репозиториев исходного коммита; таблицы извлечены из запросов, вызывающие классы и тесты указаны для модуля. Тесты модуля могут покрывать операции косвенно; результаты регрессий приведены отдельно.

| Модуль / репозиторий | Операции | Таблицы и основные вызывающие файлы | Тесты |
| --- | --- | --- | --- |
| `common/CommandRepository` | `lockStudio`, `findReplay`, `saveReplay`, `appendAudit` | `audit_events`, `idempotency_records`, `studio_settings`; `backend/common/src/main/kotlin/ru/lastochka/common/service/CommandService.kt` | `RecurringGroupsIntegrationTest.kt`, `ScheduleEditorIntegrationTest.kt`, `AdminConceptIntegrationTest.kt`, `PasswordLifecycleIntegrationTest.kt` |
| `content/LandingContentRepository` | `publishedPayload` | `landing_content`; `backend/content/src/main/kotlin/ru/lastochka/content/service/LandingContentService.kt` | `RecurringGroupsIntegrationTest.kt`, `ScheduleEditorIntegrationTest.kt`, `AdminConceptIntegrationTest.kt`, `PasswordLifecycleIntegrationTest.kt` |
| `enquiries/EnquiryRepository` | `replay`, `lock`, `insert`, `saveReplay`, `map`, `find`, `page` | `enquiry_replays`, `enrollment_requests`; `backend/enquiries/src/main/kotlin/ru/lastochka/enquiries/service/EnquiryService.kt` | `RecurringGroupsIntegrationTest.kt`, `ScheduleEditorIntegrationTest.kt`, `AdminConceptIntegrationTest.kt`, `PasswordLifecycleIntegrationTest.kt` |
| `identity/AccountLockRepository` | `lock`, `authVersion` | `accounts`; `backend/identity/src/main/kotlin/ru/lastochka/identity/service/PasskeyService.kt` | `RecurringGroupsIntegrationTest.kt`, `ScheduleEditorIntegrationTest.kt`, `AdminConceptIntegrationTest.kt`, `PasswordLifecycleIntegrationTest.kt` |
| `identity/AdminAccessRepository` | `provision`, `reset`, `revokeChallenges` | `accounts`, `webauthn_challenges`; `backend/identity/src/main/kotlin/ru/lastochka/identity/service/AdminAccessService.kt` | `RecurringGroupsIntegrationTest.kt`, `ScheduleEditorIntegrationTest.kt`, `AdminConceptIntegrationTest.kt`, `PasswordLifecycleIntegrationTest.kt` |
| `identity/ChallengeRepository` | `save`, `consume` | `webauthn_challenges`; `backend/identity/src/main/kotlin/ru/lastochka/identity/service/ChallengeStore.kt` | `RecurringGroupsIntegrationTest.kt`, `ScheduleEditorIntegrationTest.kt`, `AdminConceptIntegrationTest.kt`, `PasswordLifecycleIntegrationTest.kt` |
| `identity/ConceptRepository` | `mode` | `concept_state`; `backend/identity/src/main/kotlin/ru/lastochka/identity/config/ConceptGuard.kt` | `RecurringGroupsIntegrationTest.kt`, `ScheduleEditorIntegrationTest.kt`, `AdminConceptIntegrationTest.kt`, `PasswordLifecycleIntegrationTest.kt` |
| `identity/RateLimitRepository` | `increment` | `auth_limits`; `backend/identity/src/main/kotlin/ru/lastochka/identity/service/AuthRateLimiter.kt` | `RecurringGroupsIntegrationTest.kt`, `ScheduleEditorIntegrationTest.kt`, `AdminConceptIntegrationTest.kt`, `PasswordLifecycleIntegrationTest.kt` |
| `identity/SessionRevocationRepository` | `revokeSessions` | `spring_session`; `backend/identity/src/main/kotlin/ru/lastochka/identity/service/PasswordLifecycleService.kt`, `backend/identity/src/main/kotlin/ru/lastochka/identity/service/PasskeyService.kt` | `RecurringGroupsIntegrationTest.kt`, `ScheduleEditorIntegrationTest.kt`, `AdminConceptIntegrationTest.kt`, `PasswordLifecycleIntegrationTest.kt` |
| `identity/UserPasswordRepository` | `account`, `find`, `findPrincipal`, `lock`, `list`, `count`, `create`, `password`, `revokeChallenges`, `view` | `accounts`, `webauthn_challenges`; `backend/identity/src/main/kotlin/ru/lastochka/identity/security/PasswordCommandGuard.kt`, `backend/identity/src/main/kotlin/ru/lastochka/identity/service/PasswordLifecycleService.kt`, `backend/identity/src/main/kotlin/ru/lastochka/identity/service/AdminAccessService.kt`, `backend/identity/src/main/kotlin/ru/lastochka/identity/service/UserManagementService.kt` | `RecurringGroupsIntegrationTest.kt`, `ScheduleEditorIntegrationTest.kt`, `AdminConceptIntegrationTest.kt`, `PasswordLifecycleIntegrationTest.kt` |
| `notifications/NotificationRoutesRepository` | `record`, `targets`, `enqueue`, `deactivate`, `count`, `summary` | `browser_push_outbox`, `browser_push_subscriptions`, `enquiry_notification_routes`; `backend/notifications/src/main/kotlin/ru/lastochka/notifications/service/NotificationRoutes.kt` | `AdminConceptIntegrationTest.kt`, `JpaPostgresNativeFeasibilityTest.kt`, `PushCryptographyTest.kt` |
| `notifications/NotificationSettingsRepository` | `get`, `update` | `enquiry_notification_settings`; `backend/notifications/src/main/kotlin/ru/lastochka/notifications/service/NotificationSettingsService.kt` | `AdminConceptIntegrationTest.kt`, `JpaPostgresNativeFeasibilityTest.kt`, `PushCryptographyTest.kt` |
| `notifications/PushOutboxRepository` | `retireStale`, `claim`, `stillActive`, `finish`, `deactivate` | `browser_push_outbox`, `browser_push_subscriptions`, `enrollment_requests` (CTE `candidate`, `claimed`); `backend/notifications/src/main/kotlin/ru/lastochka/notifications/service/PushQueue.kt` | `AdminConceptIntegrationTest.kt`, `JpaPostgresNativeFeasibilityTest.kt`, `PushCryptographyTest.kt` |
| `notifications/PushSubscriptionRepository` | `save`, `deactivate`, `active` | `browser_push_subscriptions`; `backend/notifications/src/main/kotlin/ru/lastochka/notifications/service/PushSubscriptions.kt` | `AdminConceptIntegrationTest.kt`, `JpaPostgresNativeFeasibilityTest.kt`, `PushCryptographyTest.kt` |
| `notifications/TelegramRepository` | `enqueue`, `claim`, `finish`, `view`, `retry` | `telegram_outbox`; `backend/notifications/src/main/kotlin/ru/lastochka/notifications/service/TelegramQueue.kt` | `AdminConceptIntegrationTest.kt`, `JpaPostgresNativeFeasibilityTest.kt`, `PushCryptographyTest.kt` |
| `payments/PaymentRepository` | `map`, `find`, `save`, `page` | `payment_requests`; `backend/payments/src/main/kotlin/ru/lastochka/payments/service/PaymentService.kt` | `RecurringGroupsIntegrationTest.kt`, `ScheduleEditorIntegrationTest.kt`, `AdminConceptIntegrationTest.kt`, `PasswordLifecycleIntegrationTest.kt` |
| `scheduling/RecurrenceRepository` | `groups`, `group`, `saveGroup`, `series`, `series`, `saveDraft`, `discard`, `publish`, `memberships`, `link`, `unlink`, `touch`, `busyIds`, `draftIds`, `history`, `audit` | `accounts`, `recurrence_history`, `schedule_groups`, `session_edit_drafts`, `session_group_links`, `session_series`, `studio_sessions`; `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/service/SessionEditorService.kt`, `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/service/RecurrenceService.kt`, `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/service/SchedulingService.kt` | `RecurringGroupsIntegrationTest.kt`, `ScheduleEditorIntegrationTest.kt`, `AdminConceptIntegrationTest.kt`, `PasswordLifecycleIntegrationTest.kt` |
| `scheduling/SessionDraftRepository` | `find`, `save`, `delete`, `parameters`, `history`, `revision` | `accounts`, `audit_events`, `session_edit_drafts`; `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/service/SessionEditorService.kt` | `RecurringGroupsIntegrationTest.kt`, `ScheduleEditorIntegrationTest.kt`, `AdminConceptIntegrationTest.kt`, `PasswordLifecycleIntegrationTest.kt` |
| `scheduling/SessionQueryRepository` | `calendarIds`, `countOverlaps`, `findPage` | `studio_sessions`; `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/service/SchedulingService.kt` | `RecurringGroupsIntegrationTest.kt`, `ScheduleEditorIntegrationTest.kt`, `AdminConceptIntegrationTest.kt`, `PasswordLifecycleIntegrationTest.kt` |
