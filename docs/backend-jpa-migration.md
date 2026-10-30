# Поэтапный перевод backend на Spring Data JPA

Исходное состояние: коммит `3f00640`; подробная инвентаризация — `openspec/changes/migrate-backend-persistence-to-spring-data-jpa/jdbc-inventory-initial.md`. Нативные запросы остаются параметризованными в Spring Data-репозиториях. Каталог ниже перечисляет каждый запрос, его параметры и причину сохранения SQL.

| Файл и операция | Параметры | Причина |
| --- | --- | --- |
| `backend/common/src/main/kotlin/ru/lastochka/common/repo/CommandRepository.kt:21` `lockStudio` | нет | сохранить блокировку PostgreSQL |
| `backend/common/src/main/kotlin/ru/lastochka/common/repo/CommandRepository.kt:25` `replay` | `:actor`, `:key`, `:now`, `:operation` | сохранить исходные серверные значения и семантику операции |
| `backend/common/src/main/kotlin/ru/lastochka/common/repo/CommandRepository.kt:35` `saveReplay` | `:actor`, `:hash`, `:key`, `:operation`, `:response`, `:until` | сохранить атомарный upsert |
| `backend/common/src/main/kotlin/ru/lastochka/common/repo/CommandRepository.kt:52` `appendAudit` | `:action`, `:actor`, `:after`, `:before`, `:id`, `:now`, `:reason` | сохранить обработку JSONB |
| `backend/enquiries/src/main/kotlin/ru/lastochka/enquiries/repo/EnquiryRepository.kt:23` `replay` | `:key` | сохранить исходные серверные значения и семантику операции |
| `backend/enquiries/src/main/kotlin/ru/lastochka/enquiries/repo/EnquiryRepository.kt:32` `lockKey` | `:key` | сохранить блокировку PostgreSQL |
| `backend/enquiries/src/main/kotlin/ru/lastochka/enquiries/repo/EnquiryRepository.kt:37` `insert` | `:age`, `:child`, `:comment`, `:id`, `:now`, `:parent`, `:phone`, `:session`, `:snapshot` | сохранить исходные серверные значения и семантику операции |
| `backend/enquiries/src/main/kotlin/ru/lastochka/enquiries/repo/EnquiryRepository.kt:57` `saveReplay` | `:expires`, `:hash`, `:id`, `:key` | сохранить атомарный upsert |
| `backend/identity/src/main/kotlin/ru/lastochka/identity/repo/ChallengeRepository.kt:38` `store` | `:account`, `:kind`, `:payload`, `:session`, `:until` | сохранить атомарный upsert |
| `backend/identity/src/main/kotlin/ru/lastochka/identity/repo/ChallengeRepository.kt:54` `consume` | `:session` | вернуть результат атомарного изменения |
| `backend/identity/src/main/kotlin/ru/lastochka/identity/repo/RateLimitRepository.kt:26` `increment` | `:bucket`, `:now`, `:until` | сохранить атомарный upsert, вернуть результат атомарного изменения |
| `backend/identity/src/main/kotlin/ru/lastochka/identity/repo/UserPasswordRepository.kt:60` `create` | `:email`, `:expires`, `:hash`, `:id`, `:login`, `:name`, `:now` | сохранить атомарный upsert |
| `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/NotificationRoutesRepository.kt:30` `record` | `:id`, `:push`, `:telegram` | сохранить исходные серверные значения и семантику операции |
| `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/NotificationRoutesRepository.kt:39` `targets` | `:generation` | сохранить блокировку PostgreSQL |
| `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/NotificationRoutesRepository.kt:48` `enqueue` | `:id`, `:target` | сохранить исходные серверные значения и семантику операции |
| `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/NotificationRoutesRepository.kt:64` `summary` | `:id` | сохранить SQL-операции PostgreSQL, сохранить соединение таблиц владельцев |
| `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/NotificationSettingsRepository.kt:23` `currentLocked` | нет | сохранить блокировку PostgreSQL |
| `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/PushOutboxRepository.kt:27` `retireSubscriptions` | `:generation` | сохранить исходные серверные значения и семантику операции |
| `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/PushOutboxRepository.kt:36` `cancelInactive` | нет | сохранить SQL-операции PostgreSQL |
| `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/PushOutboxRepository.kt:47` `cancelInvalid` | `:generation` | сохранить SQL-операции PostgreSQL |
| `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/PushOutboxRepository.kt:58` `expire` | `:max`, `:ttl` | сохранить SQL-операции PostgreSQL |
| `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/PushOutboxRepository.kt:69` `claim` | `:generation`, `:lease` | сохранить блокировку PostgreSQL, вернуть результат атомарного изменения, сохранить SQL-операции PostgreSQL, сохранить соединение таблиц владельцев |
| `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/PushOutboxRepository.kt:91` `lockActive` | `:generation`, `:id`, `:version` | сохранить блокировку PostgreSQL |
| `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/PushOutboxRepository.kt:100` `finish` | `:attempt`, `:delay`, `:enquiry`, `:status`, `:subscription` | сохранить SQL-операции PostgreSQL |
| `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/PushSubscriptionRepository.kt:15` `upsert` | `:auth`, `:endpoint`, `:generation`, `:hash`, `:id`, `:key`, `:owner`, `:version` | сохранить атомарный upsert, вернуть результат атомарного изменения |
| `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/TelegramRepository.kt:28` `enqueue` | `:body`, `:id` | сохранить исходные серверные значения и семантику операции |
| `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/TelegramRepository.kt:36` `expire` | `:max` | сохранить исходные серверные значения и семантику операции |
| `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/TelegramRepository.kt:45` `claim` | `:lease` | сохранить блокировку PostgreSQL, вернуть результат атомарного изменения, сохранить SQL-операции PostgreSQL |
| `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/TelegramRepository.kt:55` `finish` | `:attempt`, `:delay`, `:error`, `:id`, `:message`, `:status` | сохранить SQL-операции PostgreSQL |
| `backend/notifications/src/main/kotlin/ru/lastochka/notifications/repo/TelegramRepository.kt:76` `retry` | `:id` | сохранить исходные серверные значения и семантику операции |
| `backend/payments/src/main/kotlin/ru/lastochka/payments/repo/PaymentRepository.kt:39` `create` | `:actor`, `:amount`, `:enquiry`, `:id`, `:name`, `:phone`, `:purpose` | сохранить исходные серверные значения и семантику операции |
| `backend/payments/src/main/kotlin/ru/lastochka/payments/repo/PaymentRepository.kt:57` `update` | `:amount`, `:enquiry`, `:id`, `:name`, `:phone`, `:purpose`, `:version` | сохранить исходные серверные значения и семантику операции |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/RecurrenceRepository.kt:52` `groups` | нет | сохранить обработку JSONB |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/RecurrenceRepository.kt:61` `insertGroup` | `:id`, `:p` | сохранить обработку JSONB |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/RecurrenceRepository.kt:69` `updateGroup` | `:id`, `:p` | сохранить обработку JSONB |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/RecurrenceRepository.kt:77` `series` | нет | сохранить обработку JSONB |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/RecurrenceRepository.kt:86` `insertSeries` | `:group`, `:id` | сохранить исходные серверные значения и семантику операции |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/RecurrenceRepository.kt:91` `saveDraft` | `:id`, `:p` | сохранить обработку JSONB, использовать существующую sequence |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/RecurrenceRepository.kt:100` `discard` | `:id` | сохранить исходные серверные значения и семантику операции |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/RecurrenceRepository.kt:109` `publish` | `:id`, `:p` | сохранить обработку JSONB |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/RecurrenceRepository.kt:117` `memberships` | нет | сохранить обработку JSONB, сохранить соединение таблиц владельцев |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/RecurrenceRepository.kt:126` `link` | `:date`, `:group`, `:id`, `:series` | сохранить атомарный upsert |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/RecurrenceRepository.kt:135` `unlink` | `:id` | сохранить исходные серверные значения и семантику операции |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/RecurrenceRepository.kt:143` `exception` | `:id` | сохранить исходные серверные значения и семантику операции |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/RecurrenceRepository.kt:152` `touch` | `:id` | сохранить SQL-операции PostgreSQL |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/RecurrenceRepository.kt:165` `draftIds` | `:ids` | сохранить исходные серверные значения и семантику операции |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/RecurrenceRepository.kt:173` `history` | `:id`, `:offset`, `:size` | сохранить обработку JSONB, сохранить соединение таблиц владельцев |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/RecurrenceRepository.kt:181` `countHistory` | `:id` | сохранить исходные серверные значения и семантику операции |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/RecurrenceRepository.kt:189` `audit` | `:action`, `:actor`, `:affected`, `:id`, `:operation`, `:rule` | сохранить обработку JSONB |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/SessionDraftRepository.kt:36` `draft` | `:id` | сохранить обработку JSONB, сохранить соединение таблиц владельцев |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/SessionDraftRepository.kt:46` `saveDraft` | `:actor`, `:base`, `:id`, `:now`, `:payload` | сохранить атомарный upsert, сохранить обработку JSONB, использовать существующую sequence |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/SessionDraftRepository.kt:56` `deleteDraft` | `:id` | сохранить исходные серверные значения и семантику операции |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/SessionDraftRepository.kt:60` `history` | `:id`, `:limit`, `:offset` | сохранить обработку JSONB, сохранить соединение таблиц владельцев |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/SessionDraftRepository.kt:68` `countHistory` | `:id` | сохранить исходные серверные значения и семантику операции |
| `backend/scheduling/src/main/kotlin/ru/lastochka/scheduling/repo/SessionDraftRepository.kt:72` `revision` | `:id`, `:revision` | сохранить обработку JSONB |

## Проверки совместимости и откат

Исходный коммит `3f00640` собран отдельно; его набор проверок прошёл на изолированном PostgreSQL 17.6 (87 тестов). Текущий backend прошёл `check` и `:app:bootJar` (101 тест приложения и модулей), а тесты архитектурного анализатора — ещё 10 тестов. Проверены повтор команды, откаты, версии, группы и серии, сообщения и ограничения паролей. Измерение Hibernate показало один запрос календаря для 5 и 50 занятий и два запроса страниц в обоих случаях.

На новой изолированной PostgreSQL V18 с синтетическими данными последовательно запускались исходный backend, переработанный backend и снова исходный. Одна открытая ADMIN-сессия пережила оба переключения; ответы входа, списка ключей с ранее записанным тестовым ключом, лендинга, расписания, пользователей, заявок, оплат и OpenAPI совпали. Прежняя frontend-сборка отвечала на главной и readiness на каждом этапе. Это локальная проверка, а не поставка и не фактический серверный откат; регистрация/аутентификация физическим ключом отдельно не проверялась.

Переключение назад в будущей поставке возможно только на проверенный прежний backend, совместимый с фактической схемой и действующими продуктовыми контрактами. Здесь использовались две сборки на одной V18 без восстановления старой базы. Перед реальной поставкой отдельно установить совместимость конкретных образов и выполнить резервное копирование с проверкой восстановления; не откатывать данные к старому состоянию ради отката кода.

Локальная упаковка `scripts/package-release.sh jpa-local-20261030` прошла с ранее собранными совместимыми runtime-образами `lastochka-backend:0.17.0` и `lastochka-frontend:0.17.0`; это локальный пакет, не развёртывание. При завершении одного тестового приложения очистка Spring Session была прервана закрытием тестового пула; тестовый процесс завершился успешно.

Для исходного эталона повторный запуск из отдельной копии коммита выполнялся через `JAVA_HOME=<Java 25> <копия>/backend/gradlew -p <копия>/backend check :app:bootJar`; Testcontainers создаёт отдельные PostgreSQL с синтетическими fixtures. Исходные тесты проверяли HTTP и ошибки, запись, сортировку, страницы, повторы и конкуренцию. Дополнительное сравнение API и OpenAPI выполнялось скриптом `scripts/verify-jpa-compatibility.py`; этот локальный проверочный скрипт использует только новую временную БД и удаляет её после выполнения. По исходному коду `SessionQueryRepository` получение календарных ID выполняло один SQL-вызов, страница с количеством — два; для новой реализации эти значения измерены статистикой Hibernate на 5 и 50 занятиях. Сравнение не является замером скорости под нагрузкой.

Тест `JpaPostgresNativeFeasibilityTest` дополнительно проверяет чтение настроек после bulk-обновления в той же транзакции, конфликт версии, блокировку независимого обновления, 20 конкурентных увеличений счётчика и одноразовый challenge. Для Telegram и push два независимых обработчика получают только один захват до истечения lease; после истечения доступна следующая попытка. Для списков оплат, заявок, пользователей и двух видов истории зафиксированы по два SQL-запроса (данные и количество), как у исходных JDBC-реализаций. Пагинация оплат на 25 записях сверена с исходным порядком SQL. В отдельных предварительных сборках смешанное состояние переведённых и старых JDBC-репозиториев проходило тесты соответствующих модулей.

Проверка `architectureCheck` запрещает JDBC-типы, псевдонимы, полные имена и вызовы в production. Два существующих фабричных метода WebAuthn в `IdentityConfiguration` допускаются только при точном использовании библиотечных реализаций `JdbcOperations`; попытка добавить собственный запрос в новом модуле отклонена на изолированной копии при запуске штатных задач `check` и `bootJar`. Spring Session и JDBC-внутренности библиотек сохранены; миграции и тестовые fixtures не подпадают под проверку production-кода.

Для воспроизведения сравнительной проверки подготовить отдельную копию исходного backend командой `mkdir -p runtime-data/jpa-baseline-3f00640 && git archive 3f00640 | tar -x -C runtime-data/jpa-baseline-3f00640`, собрать в ней `:app:bootJar` с Java 25, затем собрать текущий `:app:bootJar` и frontend с Node 24 и выполнить `python3 scripts/verify-jpa-compatibility.py` из проекта. Скрипт создаёт собственный PostgreSQL-контейнер, синтетические аккаунт, ключ, занятие, заявку и оплату и удаляет контейнер после проверки.
