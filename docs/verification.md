# Приёмка локальной MVP — 19 октября 2026

Последующая серверная поставка 23.10.2026: [auth0.6.0/V9](deployment/2026-10-23-auth-feedback.md),
автоматический VERIFY, пароль 6–128, общие ошибки и сохранность 9 аккаунтов/3 писем.
Локальные результаты auth и исходная MVP ниже не смешиваются с серверной приёмкой.

Актуальное дополнение 23.10.2026 —
[календарь, переносы и подтверждение «Приду»](calendar-attendance.md):
50 backend-тестов, 34 итоговых browser-сценария и отдельные проверки совместимости,
HTTPS, миграции и restore прошли локально. Сервер этим изменением не обновлялся.
Настройки ключей, очистка и будущий rollout —
[операторский runbook](calendar-attendance-operations.md).
По последующему поручению выполнена серверная поставка backend/frontend 0.5.0:
[77 публичных проверок и сохранность данных](deployment/2026-10-23-calendar-confirmation.md).

Исторические результаты первой MVP ниже относятся к прежней политике WebAuthn.
Уточнение доступа 0.3.0: 23 backend-теста прошли, 12 целевых browser-сценариев
прошли после исправлений (модальные формы 375/1440, регистрация/подтверждение,
парольный вход, роли/владельцы, reset с сохранением ключей, restart, отрицательные
подписи/origin/RP/UV/replay и добровольная привязка из двух парольных сессий).
WebAuthn теперь доброволен, отсутствие ключей не закрывает кабинет.
Production-prefix redirect проверяется в proxy/runtime, отдельном от Vite dev.
OpenAPI повторно экспортирован без изменений. Серверные результаты — в docs/deployment/.

Проверки относятся к локальной реализации и имитации поставки. Сервер
139.100.236.101 проверялся read-only и не изменялся. Это не production-релиз.
Git инициализирован, remote и коммитов нет; исходники подготовлены в индексе.

## Автоматические проверки

| Проверка | Результат / доказательство |
| --- | --- |
| Чистый Git tree snapshot без info/build/node_modules | Backend и frontend собираются; оригинальный logo.jpg совпадает с отслеживаемой копией |
| PostgreSQL integration | 19 тестов, 0 ошибок; отдельная Testcontainers БД lastochka_integration |
| Итоговый HTTP preview | 13 browser-тестов прошли на образах 0.1.3; отдельный HTTPS тест также прошёл, 14 сценариев суммарно |
| Браузер Chromium, реальные WebAuthn create/get | Регистрация/подтверждение email, родитель, дети, два ADMIN, последнее место, approve/transfer/cancel |
| Административные формы | Черновик/публикация, ручная PENDING-заявка, одобрение/отказ, перенос/отмена всего занятия; 375/1440 |
| Восстановление и ключи | Запасной ключ, отзыв, запрет удаления последнего, смена пароля с сохранением ключей и отзывом сессий |
| Отрицательные WebAuthn | Подпись, RP hash, origin, type, UV, replay, challenge TTL, привязка challenge к аккаунту; две password-сессии не обходят bootstrap |
| Опубликованный контент | Текст, изображение/alt, порядок/видимость, metadata, revision/ETag/304 меняются без пересборки и переживают restart; JS/URL не исполняются |
| OpenAPI → TypeScript | Повторный экспорт/генерация; намеренное переименование DTO отвергается TypeScript, контракт восстановлен |
| SMTP/outbox | Настоящий MailHog SMTP; retry/lease/order/FAILED, стабильный Message-ID, rollback, неоднозначный приём без второй записи |
| Backup / restore | pg_dump -Fc восстановлен в отдельную временную БД; совпали семьи/записи/ключи/аудит/контент; исходная БД не заменялась |
| MailHog persistence / isolation | Письма сохранились после restart; только internal network, нет прямых published ports/внешней пересылки |
| Prefix / SSR privacy / logout | Redirect сохраняет путь/query без внутреннего порта, deep links работают, неизвестный API возвращает JSON 404, личных данных нет в SSR, выход очищает соседнюю вкладку |
| Independent frontend rollout / rollback | Сессия и карточка ребёнка сохраняются, старые hashed chunks доступны через public-assets volume |
| HTTPS / RP | Локальный TLS proxy, play-and-say.ru: 18443 с browser-only DNS map; RP ID play-and-say.ru, Secure/HttpOnly cookie Path=/lastochka, CSRF |
| Dependency outage | При остановке только preview PostgreSQL readiness frontend/backend = 503, liveness = 200; после возврата БД все 200 без пересоздания приложений |
| Production guard | Старт production отказал до подключения datasource/Flyway, поскольку реальная доставка ещё отсутствует |
| Scroll budget | Production bundles, 375×900 и 1440×900, CPU ×4, прогретый кеш/локальная сеть: long tasks >50 ms не обнаружены |

Integration тесты также проверяют гонки approve/cancel, archive/book,
transfer/new booking и параллельную публикацию пересекающихся занятий,
индивидуальный actorId аудита, startsAt/EXPIRED, rollback вместимости/переноса,
TTL ссылок, идемпотентность и ограниченную пагинацию без переполнения offset.

CI workflow `.github/workflows/verify.yaml` подготовлен: миграции/тесты,
экспорт/генерация без diff, typecheck приложения и тестов, две сборки, browser tests.
Удалённый CI не запускался: Git remote пока не задан. Performance измеряется
отдельно на production-стеке с TEST_PRODUCTION=1, не на Vite dev server.

## Артефакты

В игнорируемом `artifacts/`: скриншоты landing/admin/parent для 375/1440,
scroll-trace-*.json и scroll-budget-*.json, preview-infrastructure.json,
readiness.json, contract-negative.txt, release-0.1.4 с двумя образами, SHA256
manifest и конфигурациями. Локальные журналы — `runtime-data/`.
Письма/credentials и пароли тестовых аккаунтов не публикуются в Git.

После проверки границ модулей accounts предоставляет bookings неизменяемое
AccountProfile без persistence-сущности/хеша пароля. Чистая backend-сборка и все
19 integration-тестов повторно прошли после изменения. Публичный OpenAPI остался
побайтово прежним; frontend release-0.1.4 использует ту же проверенную сборку.
На финальных образах 0.1.4 повторно прошли три сценария booking.spec.ts,
backup/restore, проверка MailHog и production guard.

Приложения в release-0.1.4 — linux/amd64. Рабочая машина Apple Silicon,
amd64 runtime работает под эмуляцией Docker Desktop. PostgreSQL/Nginx локального
preview могут быть arm64; подробная архитектура и память каждого контейнера
записаны в preview-infrastructure.json. Числа не являются оценкой native
производительности общего сервера. Все образы запускаются без исходников/info
и компиляции на сервере; Node runtime без npm/Vite/TypeScript, backend — JRE 25.

## Ограничения и следующий этап

- Физические passkey, Face ID/Touch ID, Android/Windows и реальный телефон
  ещё не приняты; Chromium virtual authenticator проверяет криптографический путь.
- Локальный HTTPS test certificate и DNS map не подтверждают публичный TLS/DNS
  и WebAuthn на общем сервере. Перед размещением повторяется host preflight,
  backup, проверка ресурсов и исходных `/` и `/repair_demo/`.
- MailHog только захватывает тестовые письма. RuSender выбран, но HTTPS-адаптер,
  токен, верифицированный отправитель и реальная доставка — отдельное изменение.
- Платежи, редактор лендинга, серии/абонементы/напоминания, Kubernetes manifests
  не входят в эту MVP. Модуль payments и версия контентного документа подготовлены.
- Точный адрес, тарифы и условия первого занятия не выдумывались: сайт предлагает
  уточнить их у студии. Иллюстрации из концепции не выданы за фотографии студии.


## Дополнение 20.10.2026: frontend 0.4.0

Backend/контракт/миграции остаются 0.3.0; предыдущие результаты выше — история MVP.
Для refine-landing-motion-and-booking прошли 17 локальных production browser-сценариев,
серверная HTTPS-приёмка (43 проверки), отдельные публичные touch и CPU/trace/video.
P95 16.8/16.7 ms при CPU ×4 на 375/1440, без длинных кадров >50 ms и layout events.
OpenAPI/генерируемые типы совпали с прежними. Typecheck/Prettier/build прошли.
Подробности, снимки, ограничения стенда и сохранность данных:
[отчёт frontend 0.4.0](deployment/2026-10-20-landing-refinement.md).


## Дополнение 22.10.2026: композиция карточек форматов

Локально реализован fix-format-card-image-composition: 3 новых browser-сценария
композиции и 18 релевантных production-регрессий прошли. 54 состояния матрицы
320–1920 px, 234 положения защищённых областей голов, отдельные scroll-фазы,
hover/focus/static/touch проверены. CPU ×4: p95 16.8 ms на 375/1440, 0 интервалов
>50 ms и long tasks. Typecheck, Prettier и build прошли; повторный экспорт
OpenAPI и генерация типов без изменений. Отдельная frontend-сборка без info
прошла с установленными зависимостями, без копирования прежнего build.
Новая серверная поставка в этом изменении не выполнялась.
[Полный отчёт и границы проверки](format-card-composition.md).


## Дополнение 23.10.2026: поставка frontend 0.4.1

Исправление композиции развёрнуто на публичном тестовом URL: 4 browser-сценария
матрицы/фаз/hover/static/touch/плавности и 20 операторских проверок прошли.
P95 CPU ×4 — 16.8 ms, длинных кадров и layout events нет. Подтверждены прежние
аккаунты/пароли, бизнес-данные, backend container и соседние сайты; свежий backup
сохранён. [Отчёт и ограничения](deployment/2026-10-23-format-composition.md).


## Дополнение 23.10.2026: авторизация и ошибки (только локально)

`improve-auth-verification-and-error-feedback`: 54 backend-теста на отдельных
Testcontainers PostgreSQL, 46 browser-сценариев, Java 25 bootJar, frontend typecheck/
production build/Prettier и воспроизводимая генерация OpenAPI/TypeScript прошли.
Проверены автоматический и повторный VERIFY, политика 6–128/L/Nd, legacy-вход,
каталог сообщений/advice/Security, плашки/диалоги/паузы, календарь/переносы/«Приду»,
сохранённый frontend 0.5.0 и V8→V9/restart/backup/restore. Сервер не изменялся.
[Подробные доказательства и ограничения](auth-verification-and-error-feedback.md).


## Сводка 23.10.2026: поставки и архивирование

После перечисленных локальных этапов выполнены отдельные серверные поставки
календаря 0.5.0, входа/ошибок 0.6.0, русских подсказок 0.6.1 и backend-рефакторинга 0.7.0.
Актуальны backend 0.7.0/frontend 0.6.1/mail UI 1.0.1/V9; доказательства и границы
приёмки — в [сводке проекта](project-status.md) и связанных серверных отчётах.
Все 9 изменений архивированы 23.10.2026, 299/299 задач;13 main specs прошли строгую
проверку. Исходные отчёты выше описывают свои этапы и не являются текущей сводкой.
[Архивирование и согласование требований](openspec-archive-2026-10-23.md).
