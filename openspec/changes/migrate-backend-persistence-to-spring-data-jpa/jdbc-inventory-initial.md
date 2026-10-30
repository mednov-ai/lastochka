# Исходный снимок JDBC-доступа

Снимок 30.10.2026, рабочая ветка main. Первый Git-коммит отсутствует; индекс и рабочая копия содержат ранее существовавшие изменения. Хеши ниже относятся к файлам рабочей копии, а не к коммиту.

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

- 30.10.2026: `:app:test --tests ru.lastochka.integration.AdminConceptIntegrationTest` с Java 25 и отдельным PostgreSQL Testcontainers: тестов 31, ошибок 0, отказов 0, пропущено 0. Это частичная регрессия; эталон по всем операциям и количеству запросов ещё не собран.
