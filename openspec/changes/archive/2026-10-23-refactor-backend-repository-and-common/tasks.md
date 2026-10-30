## 1. Исходное состояние и проверяемый объём

- [x] 1.1 Повторно прочитать актуальные AGENTS, design/spec и состояние соседних changes, сохранить перечень ранее изменённых файлов; проверка — baseline в `docs/backend-refactoring.md` отделяет свои изменения и фиксирует действующее состояние языкового контроля без перезаписи соседней работы.
- [x] 1.2 Завершить инвентаризацию всех production Kotlin/Gradle/resources: запросы, DB API, таблицы-владельцы, межмодульные entity/repo зависимости, литералы и повторы; проверка — все исходные 53 `.sql`/15 классов и дополнительные найденные места имеют назначенного владельца и решение, JPQL/фоновые задачи/SQL resources не пропущены.
- [x] 1.3 Зафиксировать локальные OpenAPI и сценарии совместимости на изолированной PostgreSQL V9, выполнить существующие backend-тесты на Java 25; проверка — сохранены исходные результаты и схемы без серверных действий, известные отказы окружения отделены от ошибок кода.
- [x] 1.4 Измерить SQL для страниц детей/семей/записей/занятий, календаря, целей и fingerprint на фиксированных наборах 1/20/100 и плотном периоде; проверка — в baseline есть число/категории запросов и размер результата, а не предположение о N+1 по числу строк.

## 2. Общий модуль и обработка ошибок

- [x] 2.1 Добавить library-модуль common и зависимости внутренних модулей на него, определить структуру пакетов и исключение для common/Metadata.kt; проверка — граф без циклов/common→domain/app, app единственный bootJar, модули компилируются на прежнем стеке.
- [x] 2.2 Перенести ApiError и MessageResponse в common/dto с прежними именами схем и JSON; проверка — экспорт OpenAPI и сериализация сохраняют required/nullable/имена полей, предметные DTO остаются у владельцев.
- [x] 2.3 Отвязать advice от PasswordRequest/PasswordPolicy/PasswordPolicyException: передавать точные коды constraint и общий field failure, не читать пароль в common; проверка — существующие password vectors дают прежние fieldErrors на DTO/сервисе/HTTP, новые/старые пароли проверяются по прежним разным режимам.
- [x] 2.4 Отвязать фабрику от IdentitySecurityProperties и перенести advice/factory/provider/messages.properties в common; проверка — единственный ресурс на classpath, прежние 400/404/409/429/500, Retry-After, неизвестный код и безопасный fallback без утечки секретов.
- [x] 2.5 Подключить Security к общей фабрике, проверить регистрацию одного global advice для всех существующих контроллерных модулей; проверка — ошибки identity/customers/scheduling/bookings/content и Security/CSRF имеют одинаковый прежний формат, будущий тестовый контроллер нового пакета покрывается автоматически.
- [x] 2.6 Согласовать новый путь catalog с действующим языковым контролем; проверка — русские сообщения проходят, намеренно внесённая английская публичная строка в common catalog отклоняется, секреты/rejectedValue не попадают в ответ/журнал.

## 3. Общая инфраструктура и repo

- [x] 3.1 Перенести технический механизм команд из scheduling в common с отдельными repo-операциями studio lock/idempotency/audit и типизированной записью replay; проверка — существующие повторы, конфликт ключа/версии, rollback и гонка последнего места проходят, сервисы не содержат SQL.
- [x] 3.2 Перенести запросы auth tokens, cleanup VERIFY и revoke sessions/challenges в identity/repo; проверка — expiry, повтор VERIFY до исходного expiry, RESET один раз, отзыв сессий и BEFORE_COMMIT отзыв attendance сохраняются на реальной PostgreSQL.
- [x] 3.3 Перенести advisory lock регистрации, rate counters и challenge storage в identity/repo, сохранив REQUIRES_NEW/noRollbackFor на правильной сервисной границе; проверка — параллельная регистрация, счётчик после отката и расходование неверного challenge сохраняют прежний результат через Spring proxy.
- [x] 3.4 Скрыть credential repositories/SQL locks за identity repo-операциями и предоставить immutable account-access snapshot для bookings; проверка — нет межмодульного repo/entity доступа, управление/отзыв ключей и гонки reset/enrollment/attendance сохраняют authVersion и актуальные блокировки.
- [x] 3.5 Перенести children queries в customers/repo и поиск родителей в identity с типизированным контрактом; проверка — filters/page/total/order и семейная изоляция прежние, CustomerService не читает accounts SQL и не разбирает DB maps.
- [x] 3.6 Перенести календарные/списочные запросы и пересечения в scheduling/repo; проверка — границы периода, cap, список публичных состояний, capacity/conflicts и REPEATABLE_READ прежние, SQL-фрагментов в SchedulingService нет.
- [x] 3.7 Перенести grants/context queries и mapping в bookings/repo; проверка — token/generation/authVersion/email/revision/expiry/nonce/Origin/CSRF и повтор confirm проверяются существующей регрессией, AttendanceService читает типизированные результаты.
- [x] 3.8 Перенести preview/participants fingerprint/transfer-target queries в bookings/repo, описать узкий read join с scheduling; проверка — actor/expiry/fingerprint/replay/пагинация и повторная финальная проверка ресурсов прежние, нет listOfRows/casts в сервисе.
- [x] 3.9 Перенести outbox enqueue/claim/success/failed/cleanup в notifications/repo, оставить orchestration/decrypt/policy/retry в сервисах; проверка — SKIP LOCKED, порядок aggregate/sequence, lease, attempts, encrypted payload, стабильный Message-ID и неоднозначный SMTP результат сохраняются.
- [x] 3.10 Вернуть очистку attendance_contexts/move_previews владельцу bookings и оформить узкий read join outbox→grants; проверка — истёкшие временные записи удаляются в прежние сроки, посторонние записи/письма не затронуты, notifications не меняет таблицы bookings.
- [x] 3.11 Перенести чтение landing_content в content/repo без изменения content validation; проверка — опубликованный документ/SSR контракт и безопасные ограничения ресурсов прежние, запросов вне repo по итоговой инвентаризации нет.

## 4. Metadata и упрощение

- [x] 4.1 Создать сгруппированный Metadata.kt и таблицу классификации литералов: error/field/protocol/security/domain action/status/limits/time; проверка — каждой найденной смысловой константе назначена группа/единицы измерения, конфигурация и секреты не зашиты, совпадающие по значению разные правила имеют разные имена.
- [x] 4.2 Заменить смысловые inline-литералы/локальные дубли во всех production-модулях, включая аннотации/шаблонные операции, на Metadata; проверка — catalog coverage, значения API/БД и idempotency/audit codes прежние, SQL остаётся в repo и пользовательские фразы в ресурсах.
- [x] 4.3 Убрать повтор сборки письма/подписей BookingService, сохранив варианты обычного и защищённого уведомления; проверка — сравнение subject/body/времени/ссылок/числа событий и профильная outbox-регрессия, общие части описаны один раз.
- [x] 4.4 Устранить поштучные чтения в списках/календаре/целях/fingerprint через пакетные операции и проекции; проверка — повтор измерений 1.4 подтверждает отсутствие линейных per-item запросов, полнота, сортировка, filters/caps/page/total и fingerprints прежние.
- [x] 4.5 Переименовать неясные операции/локальные переменные, удалить неиспользуемый параметр SchedulingService.check, перенести правило публичного чтения занятия в сервис; проверка — читатель видит последовательность предметных действий, контроллеры тонкие, operationId/URL/404 прежние, каждый удалённый элемент имеет проверенные usage sites.
- [x] 4.6 Проверить передачу сущностей в контроллеры и между модулями, оставить наружу текущий actor id/проекции через сервисные контракты; проверка — зависимости controller→entity/repo и cross-module entity/repo отсутствуют, роли/владение/права не изменены.
- [x] 4.7 Удалить ненужные общие Gradle starters/plugins, подключив зависимости по использованию; проверка — compile/test/runtime classpath всех модулей и запуск итогового JAR проходят, payments остаётся без операций и app без frontend.
- [x] 4.8 Повторно оценить каждый модуль на повторы/лишние ветки/сложные цепочки и оформить «удалено/объединено/сохранено с причиной»; проверка — отчёт с конкретными местами и regression evidence, нет квоты LOC, новых BaseService/DAO-framework и дробления на бессмысленные wrappers.

## 5. Блокирующие архитектурные правила

- [x] 5.1 Добавить architectureCheck с автоматическим охватом main source sets и графа Gradle, минимальным синтаксическим анализом Kotlin и diagnostic file/location/rule; проверка — новый временный модуль автоматически анализируется, parser остаётся build/test dependency и не входит в runtime JAR.
- [x] 5.2 Запретить DB API/query text/fragments/binding/row mapping вне repo, controller→repo/entity и cross-module repo/entity; проверка — отрицательные примеры alias/qualified import/multiline/template/query annotation/SQL resource/wrapper отклоняются, корректные repo/JPA declarations/migrations/test fixtures проходят.
- [x] 5.3 Проверять направление common, циклы, единственность global advice, root-package hygiene и catalog coverage; проверка — изолированные примеры common→identity, чужого repo, дополнительного advice и root service отклонены, launcher/Metadata в оговорённых местах проходят.
- [x] 5.4 Проверять классифицированные смысловые литералы, включая однократное новое правило, локальную константу-дубль и annotation/template usages; проверка — bypass cases отклоняются, column/bind names в repo/обычные данные/0–1/SQL grammar не дают ложных отказов, нет blanket allowlist/baseline старых нарушений.
- [x] 5.5 Подключить контроль к корневому check, app check/bootJar и штатным backend build/package entrypoints; проверка — временное нарушение реально блокирует каждый путь, включая упаковку уже собранного JAR из изменённого дерева, после удаления проходят без обходных флагов; будущий CI использует ту же команду.

## 6. Общая приёмка и документация

- [x] 6.1 Выполнить полный backend check/test/bootJar на Java 25 и изолированной PostgreSQL с выключенным и включённым attendance, проверить workers/startup/health; проверка — существующие тесты и необходимые проверки новых архитектурных границ проходят, транзакционные режимы не заменены mocks.
- [x] 6.2 Проверить данные совместимости старого backend: сохранённые command responses, действующие preview/fingerprint и session/WebAuthn payload; проверка — новый backend читает их на прежней V9, replay прежний, миграций и массового отзыва/перезаписи данных нет, обратный запуск прежней версии не требует schema rollback.
- [x] 6.3 Экспортировать OpenAPI, сравнить schema/operationId/JSON/required/nullable/status/fieldErrors, штатно сгенерировать frontend client; проверка — нет необъяснённого contract diff, ручных transport DTO/правок generated files, frontend typecheck/build проходят.
- [x] 6.4 Прогнать затронутую browser-регрессию с прежним frontend: вход/VERIFY/RESET/старый пароль, дети, календарь, переносы, анонимное «Приду», видимые ошибки en-US/ru-RU на 375/1440; проверка — прежние русские сообщения/полевые ошибки, доступные подписи, права и важные результаты сохраняются.
- [x] 6.5 Завершить `docs/backend-refactoring.md`: таблица до/после, владельцы repo/common/Metadata, query counts, рекомендации с источниками, сохранённая сложность и результаты/ограничения; обновить AGENTS/config по действительным правилам; проверка — отчёт отличает статический аудит, локальную реализацию и серверную поставку, локальный этап сервер не менял.
- [x] 6.6 Выполнить форматирование, финальный архитектурный контроль и `openspec validate refactor-backend-repository-and-common --strict`; проверка — все задачи отмечены только по доказательствам, чужие правки/данные сохранены, артефакты согласованы, change не архивируется автоматически.

Последующая отдельно разрешённая поставка backend 0.7.0 выполнена 23.10.2026;
сохранность, публичные проверки и откат — `docs/deployment/2026-10-23-backend-refactoring.md`.
