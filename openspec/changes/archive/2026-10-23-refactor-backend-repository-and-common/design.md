## Context

Мотивация — в `proposal.md`. Статическое обследование 23.10.2026 охватывает дерево production Kotlin, основные сервисные сценарии, контроллеры, репозитории, ошибки, DTO и Gradle; это не результат запуска тестов, измерения нагрузки или серверного аудита. Снимок: 82 production-файла Kotlin, 4973 строки; 8 Gradle-модулей, из них payments без Kotlin. Эти числа — ориентир объёма, а не доказательство избыточности. В рабочем дереве много ранее подготовленных/изменённых файлов, их нельзя перезаписывать или откатывать целиком.

### Findings

| Приоритет | Проверенное место | Наблюдение | Решение и доказательство |
| --- | --- | --- | --- |
| P1 | `identity/service/{EmailTokenService,ChallengeStore,AuthRateLimiter,RegistrationService,PasskeyService,VerificationTokenCleanup}.kt` | 15 вызовов `.sql`, включая advisory/account locks, расходование challenge и отзыв сессий | Предметные методы в identity/repo; сохранить атомарность и независимый commit счётчиков/расходования challenge |
| P1 | `bookings/service/{AttendanceService,AttendanceRevocationListener,MovePreviewService}.kt` | 16 вызовов `.sql`, смешаны проверки ссылки, mapping строк, выдача разрешения и preview | Репозитории разрешений/контекстов/preview; типизированные записи и сохранение generation/revision/expiry/nonce |
| P1 | `scheduling/service/{SchedulingService,CommandService}.kt` | 8 вызовов `.sql`; CommandService одновременно блокирует студию, хранит idempotency и пишет аудит, используется customers/bookings | Общий технический механизм команд в common с узкими репозиториями, атомарность оставить на границе сценария |
| P1 | `customers/service/CustomerService.kt` | 4 вызова `.sql`, поиск аккаунтов другого модуля, карты строк и поштучное получение детей | Поиск родителей через контракт identity; свои выборки детей в customers/repo |
| P1 | `notifications/service/{NotificationService,OutboxStore}.kt`, `content/service/LandingContentService.kt` | 9 + 1 вызов `.sql`; OutboxStore чистит `attendance_contexts` и `move_previews` | Запросы очереди и контента в собственных repo; очистку контекстов/preview вернуть владельцу bookings |
| P1 | `app/error/ApiExceptionHandler.kt`, `ApiErrorFactory.kt` | Глобальный advice уже существует, но зависит от PasswordRequest/PasswordPolicy/PasswordPolicyException и IdentitySecurityProperties | Убрать обратные зависимости перед переносом в common; сохранить точность password fieldErrors и 429 |
| P1 | `bookings/service/AttendanceService.kt` | Прямая зависимость от `identity.repo.AccountRepository` и его Account | Узкий identity-контракт проверки/блокировки аккаунта с проекцией; блокировка живёт в общей транзакции |
| P2 | `BookingService.kt:notify` | Два похожих тела письма и две карты подписей статусов; обычное и защищённое письмо сейчас различаются деталями времени | Общие части собирать один раз, явно сохранить различия вариантов; проверка содержимого/ссылок/числа событий |
| P2 | `BookingService.kt:view,childOverlap,hasFutureBookings`, `SchedulingService.kt:list,calendar`, `MovePreviewService.kt:targets,fingerprint`, `CustomerService.kt:list,families` | По коду видны поштучные чтения связанных объектов/занятости; N+1 вероятен, точное число не измерялось | Снять число запросов до изменения; пакетные предметные чтения/проекции без изменения page/total/порядка |
| P2 | `MovePreviewService.kt:confirm`, `ChallengeStore.kt:consume`, `CommandService.kt:execute`, `CustomerService.kt:families` | `listOfRows`, строковые ключи, casts UUID/Timestamp | Типизированные записи репозиториев; преобразование БД остаётся внутри repo |
| P2 | `BookingService.kt` (398 строк), `AttendanceService.kt` (316), `SchedulingService.kt` (244) | Несколько обязанностей в одном классе; короткие `b/s/a`, `one`, `action`, `check`, Boolean-флаги скрывают назначение | Сначала вынести persistence, затем разделить только самостоятельные обязанности; предметные имена и именованные аргументы |
| P2 | `SchedulingService.kt:check` и `SessionController.kt:one` | Неиспользуемый параметр `id` проверки; правило публичной видимости находится в контроллере | Удалить параметр после проверки вызовов; публичное чтение оформить сервисным методом с прежним 404 |
| P2 | `backend/build.gradle.kts` | Все subprojects получают Web MVC/JPA/Security/Jackson/Validation и JPA plugin, включая payments | Явные зависимости по потреблению, проверить compile/runtime classpath и итоговый bootJar |
| P3 | `app/config/OpenApiConfiguration.kt`, DTO | Значительный объём аннотаций/схем WebAuthn и явной required/nullability | Не удалять как «лишний»: подтверждённое назначение — корректная генерация клиента; проверить contract diff |

Итого: **53 места вызова `.sql(...)` в 15 production-классах вне repo**. Это не число уникальных запросов: есть динамические фрагменты и повторное использование. Существующие JPQL `@Query` в repo — правильное размещение. Интерполяции найденных SQL используют собственные фрагменты и bind-параметры; сам факт интерполяции не доказывает SQL injection.

Активный `localize-user-hints-in-russian` по фактическим tasks уже имеет 15/20 задач; AGENTS ещё описывает ранний план. Его файлы, каталог и проверки не перезаписывать. Перед apply повторно сверить состояние; перенос messages согласовать с языковым контролем. Основные specs пока не опубликованы, продуктовые контракты читать в существующих changes и тестах.

## Goals / Non-Goals

**Goals:**

- Закрепить запросы за repo, общую инфраструктуру — за common, а предметные решения — за сервисом владельца.
- Упростить чтение сценария и убрать подтверждённые повторы/поштучные загрузки с измеряемым результатом.
- Сделать нарушения структуры и обход Metadata причиной отказа стандартной сборки.
- Сохранить прежнюю схему БД, HTTP/OpenAPI, сообщения, поведение и транзакционные инварианты.

**Non-Goals:**

Полная замена JDBC на JPA, новая ORM/query DSL, универсальный CRUD-framework, обязательные интерфейс/impl на каждый класс, микросервисы, переход на новый стек, новые продуктовые функции, переписывание frontend и серверная поставка. Не сокращать защиту, outbox, WebAuthn, шифрование или OpenAPI-аннотации ради числа строк.

## Decisions

### 1. Общий library-модуль с ограниченной ответственностью

Добавить `:common` и прямую зависимость на него у внутренних модулей, включая app/payments. Пакет — `ru.lastochka.common`; единственное разрешённое исключение корневого файла внутри этого пакета — запрошенный `Metadata.kt`. Корень приложения `ru.lastochka` по-прежнему содержит только launcher. Предметные корни содержат intentional subpackages.

Начальная структура common:

```text
common/src/main/kotlin/ru/lastochka/common/
  Metadata.kt
  dto/                 ApiError, MessageResponse
  error/               advice, фабрика, MessageProvider, общие field failures
  config/              только собственные общие настройки/связывание
  service/             общий механизм команд, аудита и блокировки
  repo/                запросы idempotency, audit_events, studio_settings
common/src/main/resources/messages.properties
```

`common` не зависит от app/identity/bookings/других предметных модулей, не знает сущностей Account/Booking/Session и не хранит их правила. Общий механизм команд принимает actor/operation/JSON и действие, не вызывает предметные сервисы. Studio lock — техническое средство сериализации для одного зала, а не перенос логики расписания в common.

Общими DTO считаются `ApiError` и нейтральный `MessageResponse`; одинаковая форма страницы сама по себе не повод менять BookingPage/SessionPage/ChildPage на generic DTO. AccountProfile и AccountAccessRevoked остаются контрактами identity, SessionView — scheduling, OutboxMessage — notifications. Межмодульное использование не делает предметный тип общим. Имена OpenAPI schemas сохранять явно, если перенос пакета влияет на экспорт.

Альтернативы: папка common внутри app недоступна нижним модулям без обратной зависимости; общий контейнер всех DTO/сервисов стирает владельцев. Отдельный library-модуль даёт проверяемое направление зависимостей.

### 2. Запрос и преобразование результата целиком находятся в repo

Сохранить JPA для уже управляемых сущностей и JdbcClient для запросов, где он уместен. Нативный SQL допустим; проблема — место и обязанности. Репозиторий хранит полный запрос/фрагменты, привязывает параметры и возвращает типизированный результат. Сервис определяет бизнес-условия, момент времени и транзакционную последовательность.

Ожидаемое распределение, без обязательного класса на каждую таблицу:

| Владелец | Операции repo |
| --- | --- |
| identity | аккаунты/блокировки, auth tokens, rate counters, WebAuthn challenges, отзыв сохранённых сессий и адаптер credential repositories |
| customers | дети, страницы и пакетное чтение по parent ids |
| scheduling | интервалы, пересечения, занятость через контракт бронирований |
| bookings | записи, разрешения «Приду», контексты, preview, их очистка и пакетные проекции |
| notifications | enqueue/claim/result/retry/cleanup outbox |
| content | опубликованный документ |
| common | технические studio lock, idempotency и audit |

Примеры понятных операций: `findSessionsInPeriod`, `findChildrenByParents`, `findActiveGrant`, `consumeChallenge`, `revokeAccountSessions`, `claimNextMessage`. Не передавать из сервиса строку SQL, таблицу, WHERE-фрагмент или `Map<String, Any?>` строки БД. Внутри repo именованные параметры/локальные column names допустимы; межмодульный repo не может возвращать чужую JPA entity.

Узкие адаптеры WebAuthn в identity/repo скрывают JdbcUserCredentialRepository/JdbcPublicKeyCredentialUserEntityRepository от бизнес-сервисов. Spring configuration может связывать инфраструктурные beans с DataSource/JdbcOperations, но не выполнять/объявлять запросы; исключение проверять по конкретному назначению метода, не всему config-пакету. Spring Session/Flyway и SQL внутри сторонних библиотек не копировать в собственные репозитории. DDL остаётся в migrations, setup/assert SQL — в тестах, эксплуатационные SQL scripts — вне production-кода и в инвентаризации.

Чтение чужих таблиц выделить в явные операции владельца. Поиск родителей принадлежит identity. Для attendance нужен контракт identity, возвращающий immutable account access snapshot и выполняющий pessimistic lock в вызывающей транзакции; entity наружу не выходит. Для read-only join bookings+sessions в поиске целей переноса разрешить один явно документированный query-repository владельца сценария bookings: он не меняет чужие таблицы и использует согласованную проекцию. Не создавать отдельную абстракцию для каждой строки SQL.

Очистка attendance_contexts/move_previews выполняется worker владельца bookings. Outbox repo может читать attendance_grants для существующего условия очистки encrypted payload: это узкий описанный read join; запись/отзыв grants остаётся bookings. Эти два межмодульных read join — явные точки сцепления, не разрешение произвольных обращений ко всем таблицам.

Альтернативы: перенос только текстов SQL в файл оставляет binding/mapping в сервисе; массовая смена persistence увеличивает риск без необходимости; универсальный DAO скрывает смысл операций.

### 3. Metadata как каталог значений, а не ещё один сервис

Создать `object Metadata` в `common/Metadata.kt`, по стилю найденного примера Flowable (`backend/.../utils/Metadata.kt`, объект с вложенной ErrorMessages). Имя файла и назначение заданы пользователем; Kotlin object не требует экземпляров и соответствует характеру констант.

Группы: `ErrorCodes`, `Fields`, `Http` (headers/cookies/media types/route fragments), `Security` (roles/authorities/session attributes/token kinds), `Booking` и `Scheduling` (собственные статусы/actions), `Attendance`, `Notifications`, `Commands`, `Limits`, `Time`. При росте — узкие вложенные группы, например `Metadata.Identity.Password.MIN_CODE_POINTS`. Не создавать плоскую тысячу несвязанных строк. Числа содержат единицы измерения: `PREVIEW_TTL_SECONDS`, `MAX_PERIOD_DAYS`; настройки окружения продолжают переопределять прежние defaults.

Выносить не только повторяемые строки, но и однократный литерал, задающий правило или контракт: код ошибки, лимит, TTL, regex политики, имя cookie/attribute, операция idempotency, audit action, wire status. В аннотациях использовать доступные compile-time constants. Вместо динамического `"BOOKING_${input.action}"` — явное соответствие actions и audit codes. Значения провода/БД не менять; enum применять только там, где он упрощает код и сохраняет прежнюю сериализацию, без массового перевода контрактов.

Не выносить механически пустые строки, 0/1 для индексов/счётчиков, SQL-грамматику, локальные column aliases и bind names в repo, тестовые данные, Kotlin/Java-идентификаторы. Имя поля публичного контракта и техническое имя колонки — разные контексты. Пользовательские фразы и шаблоны писем хранятся в `messages.properties`/собственных ресурсах с ключами из Metadata; логи могут иметь локальные шаблоны без секретов. Рабочие URL, ключи, generation, секреты и пароли — только конфигурация/данные.

Разные понятия с одинаковым значением получают разные имена: срок WebAuthn challenge и срок preview сейчас равны пяти минутам, но это разные правила. Общие операции хеширования/случайных секретов выделять только после сравнения charset, формата, длины и назначения; не объединять протоколы ссылок по совпадению SHA-256.

### 4. Один advice для всех модулей с безопасной общей фабрикой

Перенести существующие ApiExceptionHandler, ApiErrorFactory, MessageProvider и единственный ресурс messages.properties. Глобальный advice зарегистрирован в общем component scan без списка отдельных контроллеров. Security handlers в app продолжают сериализовать ответы через ту же фабрику: advice не перехватывает автоматически исключения фильтров.

Убрать зависимость advice от PasswordRequest/PasswordPolicy: PasswordValueValidator уже создаёт constraint message template с точным кодом. Общая обработка извлекает только разрешённый шаблон/код constraint, не `rejectedValue`, и разрешает его через каталог. Сервисный password failure передаёт общий тип ошибки с `fieldCodes`; сама Unicode-политика остаётся identity. Если Spring binding не сохраняет нужный шаблон, адаптация выполняется в identity validator до общей границы, без импорта identity в common. Не выводить raw defaultMessage. Сохранить приоритет FIELD_REQUIRED/EMAIL/LENGTH и отдельные режимы нового/старого пароля.

Retry-After должен получать прежнее значение из независимых общих error-response settings либо узкой настройки, связываемой app; common не импортирует IdentitySecurityProperties. Число/формат заголовка не менять в рамках рефакторинга. Background workers сохраняют собственные retry/lease/error codes; отдельный MVC advice для notifications/payments не нужен, пока там нет контроллеров. У будущих контроллеров общая обработка подключается автоматически.

Не менять совместимую ошибку на иной JSON/RFC-формат. Не добавлять общий `catch(Exception)` в каждый сервис; существующие broad catches WebAuthn/доставки проверить по назначению. Неожиданные ошибки дают безопасный fallback и requestId; секреты/SQL/пароли/тела запросов не логируются.

### 5. Простота оценивается по сценарию и доказательствам

После извлечения persistence повторно оценить размеры сервисов: выделять самостоятельные сборку письма, mapping или механизм команд, а не дробить каждое условие на новый bean. Имена методов — английские глагольные предметные фразы в camelCase, например `confirmAttendance`, `previewSessionMove`, `transferBooking`, `requireOpenSession`, `findBookingForParent`; русские пояснения в документации. Внешние operationId/URL сохранять при переименовании внутренних методов.

Локальные `booking/session/account/parentId` читаются лучше `b/s/a`, особенно в вложенных lambdas. Использовать обычные if/when, guard clauses и именованные аргументы; избегать длинных цепочек scope functions, рефлексии ради дедупликации, generic BaseService/BaseRepository и интерфейсов без второго назначения. Простое однострочное mapping может остаться локальным; сложное/повторяемое — в mapper. Общая проверка страницы/периода допустима только при одинаковой семантике, сохранении кодов и без универсального validation-framework.

Списки получать пакетами: страницы детей сразу с данными; связанные дети/занятия и occupied counts по набору ids; fingerprint участников — типизированной стабильной выборкой. Число запросов измерить на размерах 1/20/100, для календаря также на плотном периоде. Цель — устранить линейные per-item чтения при стабильном наборе запросов/пакетов; без «магического» универсального лимита. Сохранить разные предикаты list `[startsAt]` и calendar `[overlap]`, стабильные сортировки, caps и totals.

В Gradle оставить общими toolchain/BOM/compiler/test conventions, библиотеки подключать по реальному использованию. Common web/error infrastructure может иметь MVC/validation зависимости, но не автоматически JPA/Security/WebAuthn без потребления. Для common технических repo явно нужны JDBC/transaction; app остаётся единственным bootJar. Runtime classpath, component/entity/repository scan проверяются реальной загрузкой приложения.

### 6. Обязательный контроль без собственного сложного фреймворка

Добавить Gradle `architectureCheck` для всех main source sets и зависимостей модулей. Вызывать из корневого `check`, `:app:check`, `:app:bootJar` и существующих build/package entrypoints; публикуемые backend-пакеты не могут обходить его через прежнюю готовую сборку без проверки исходного состояния. Не требовать полный browser-suite на каждом bootJar.

Контроль зависимостей — по классам/импортам и графу Gradle; контроль запросов, аннотаций и литералов — через синтаксическое дерево Kotlin (доступный parser/tooling текущего Kotlin) с небольшим набором правил. Во время реализации выбрать минимальное совместимое подключение parser без нового runtime dependency. Простой поиск rg годится для инвентаризации, но недостаточен как единственная защита от alias, qualified names, multiline strings и string templates. Тесты проверяют реальные ложные допуски/отказы, не копируют implementation rules.

Проверяемые категории: DB API вне repo; запрос/SQL-фрагмент вне repo, в том числе ресурсы с SQL, загружаемые сервисом; controller→repo/entity; common→domain/app; межмодульные repo/entity imports и циклы; дополнительные global advice; недопустимые root files; дубли смысловых литералов и кодов; полнота error catalog. Metadata/ресурсы классифицируются отдельно от обычного кода. Разрешения задаются узко по правилу и точке использования с причиной; не сохранять baseline из 53 нарушений и не отключать проверку для целого пакета. Архитектурный контроль не доказывает полноту динамического поведения — читаемость/бизнес-инварианты дополнительно оцениваются ревью и регрессией.

### References

Предлагаемые практики сверены с первичными источниками 23.10.2026; это обоснование подхода, а не поручение обновить версии библиотек:

- [Spring JDBC](https://docs.spring.io/spring-framework/reference/data-access/jdbc/core.html): параметризованные запросы, RowMapper и общая обработка ошибок доступа к данным.
- [Spring DAO support](https://docs.spring.io/spring-framework/reference/7.1/data-access/dao.html): роль @Repository и DataAccessException; не оборачивать каждый отказ БД произвольным catch.
- [Spring transactions](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/annotations.html): proxy boundaries и self-invocation важны при переносе @Transactional.
- [Spring JPA transactions](https://docs.spring.io/spring-framework/reference/data-access/orm/jpa.html): JDBC и JPA должны участвовать в транзакции одного DataSource/совместимого transaction manager.
- [Spring controller advice](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-advice.html): глобальный advice применяется ко всем контроллерам; границу Security обрабатывать отдельно.
- [Kotlin conventions](https://kotlinlang.org/docs/coding-conventions.html): содержательные глагольные имена методов, именованные аргументы, смысловая группировка, UPPER_SNAKE_CASE constants.

## Risks / Trade-offs

- [Смена транзакционной границы] → не переносить propagation с сервисов механически; сохранить MANDATORY, REQUIRES_NEW/noRollbackFor, REPEATABLE_READ, account/studio/advisory locks, порядок блокировок, flush перед JDBC-чтением и BEFORE_COMMIT listener. Проверить через Spring proxy на PostgreSQL, не только mocks.
- [JPA cache и JDBC дают разные версии] → возвращать актуальный snapshot под блокировкой; проверить persistence context/flush в гонках reset, enrollment, attendance и move.
- [Рост common] → список владельцев и запрет обратных зависимостей; новые предметные DTO/правила туда не переносятся.
- [Упрощение меняет fingerprint/idempotency] → сохранить порядок/сериализацию и replay существующих записей; протестировать preview, созданный старым backend, и старые сохранённые command responses на прежней БД. Иначе описать несовместимость до поставки, а не молча отзывать данные.
- [Перенос Kotlin классов ломает Java serialization] → не менять имена сохраняемых Spring Session/WebAuthn сериализуемых типов; проверить чтение старых session/challenge payload новым приложением. Metadata не хранит runtime state.
- [Перенос DTO ломает схемы] → нормализованный OpenAPI diff, проверка operationId/schema/nullable/required и генерация клиента штатным инструментом.
- [Два messages.properties или обход языкового сканера] → единственный catalog на classpath, catalog coverage и обновление точного пути в языковом контроле с отрицательным примером.
- [Слишком много новых абстракций] → первый проход — механическое извлечение persistence; затем выделение только доказанных повторов. В отчёте объяснять прирост файлов/строк, не устанавливать квоты LOC/длины методов.
- [Нарушение ownership уборкой данных] → lifecycle cleanup принадлежит модулю владельца, не удалять существующие записи/письма ради удобства тестов.

## Migration Plan

1. Зафиксировать локальный baseline исходников, OpenAPI, зависимостей, тестов и query counts. Использовать только собственную изолированную Testcontainers/Compose БД; никаких запросов на сервер. Ранее незакоммиченные изменения сохранить.
2. Добавить common, перенести error contracts/resources и нейтральную инфраструктуру команд, убрать обратные зависимости. Проверить bootJar/component scan, ошибки/защиту/пароль до остальных перемещений.
3. По модулю переносить запросы в repo с неизменными SQL/binding/transaction semantics; отдельно менять владельца межмодульных операций/cleanup. После каждой группы — соответствующая существующая регрессия.
4. После эквивалентного переноса централизовать Metadata, устранить повторы и N+1, уточнить имена и Gradle dependencies. Для каждого существенного упрощения — результат сравнения.
5. Включить контроль без baseline-исключений, проверить все отрицательные примеры и реальные build/package entrypoints. Пройти общую регрессию, экспорт/генерацию API и совместимость прежнего frontend.
6. Оформить локальный отчёт и актуальные правила AGENTS. Tasks отмечать только по результатам. Развёртывание/архивирование — отдельное поручение. На возможной будущей поставке прежний backend остаётся совместим с той же БД; никаких Flyway миграций этот change не добавляет. Подготовленные старой версией commands/preview/sessions — часть проверки совместимости перед такой поставкой.

Локальная реализация, performance baseline и итоговые проверки выполнены; результаты и ограничения — в `docs/backend-refactoring.md`. Нерешённых вопросов, требующих изменения продуктового объёма, нет; конкретные имена repository records и точные количества SQL определяются при реализации с сохранением этого контракта.


### Implementation Notes

При реализации сохранён JDBC для страниц детей с Long offset: JPA имеет предел
смещения Integer.MAX_VALUE, а прежний контракт допускал больший offset. Общие
шаблоны результатов и писем находятся в отдельном user-messages.properties;
строгий каталог ошибок messages.properties сохранён. Пять простых guard-функций
в common/error убирают 79 повторов конструктора прежнего ResponseStatusException.
Kotlin PSI запускается в отдельном build-only процессе, чтобы не помещать compiler
в classloader Kotlin Gradle plugin или runtime JAR. Поиск main source directories
не обходит изменяемые Gradle build/cache directories. Обработку SQL resources
проверяют независимо от суффикса .sql; production Java до добавления его правил
отклоняется. Все эти решения сохраняют принятые продуктовые требования.
