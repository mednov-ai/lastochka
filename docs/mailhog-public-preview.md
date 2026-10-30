# expose-mailhog-test-preview — локальная приёмка

23.10.2026. Этот отчёт фиксирует локальный этап до серверной поставки.
Последующая поставка по отдельному поручению —
[серверный отчёт](deployment/2026-10-23-mailhog-public-preview.md).
OpenSpec архивирован 23.10.2026; основные требования синхронизированы. Backend/frontend application source,
JAR/SSR-контракт, OpenAPI и миграции в этом change не менялись. Для интеграции
использованы уже собранные локальные приложения с предыдущим auth change V9;
это не означает его серверную поставку. Действующие контейнеры/БД/туннель не заменялись.

## Результат

Отдельный статический профиль MailHog и Nginx proxy обслуживают
`/lastochka/mail_hog_test/` без пароля. Без завершающего `/` — 308 с query.
Это общий публичный inbox с прежними/новыми письмами, поиском/страницами,
отправителем/получателем/датой, текстом и HTTP(S)-ссылками. WebSocket работает через
shared edge → preview proxy → public proxy → MailHog, включая reconnect.

Доступ к управлению ограничен серверной allowlist: публично запрещены mutations,
Release/import/Jim/outgoing SMTP, raw MIME/HTML/attachments. Письмо показывается
текстовыми узлами DOM, ссылки создаются отдельно, без HTML/$compile/$sce. Полная
операторская UI/API и SMTP остаются закрытыми и неизменными. Internal mail network
не имеет внешнего выхода. Credentials удаляются на прокси, Set-Cookie блокируется.

Default false: в базовом preview proxy весь подпуть явно отвечает 404 без зависимости
от public image. Отдельный аддитивный overlay включает маршрутизирующую конфигурацию
и public service; сам сервис также default false. Включение разрешено только с
`test-preview`/HTTPS origin. Выключение с force-recreate public service закрывает
прежние WSS и возвращает 404 UI/assets/API/WS, без остановки SMTP/операторского канала.

## Проверки и доказательства

| Проверка | Результат |
|---|---|
| Публичный профиль, итоговый Linux/amd64 image, HTTPS через три прокси | 10 browser-сценариев, все прошли |
| Auth/calendar/landing/routing | 26 сценариев прошли; отдельный production scroll/CPU×4 — ещё 1 прошёл; суммарно 37 разных browser-сценариев с public profile |
| UI 375/768/1440, refresh/308/empty/live SMTP/reconnect | Пройдено, скриншоты просмотрены |
| Политика прямых HTTP-запросов, заголовки, обходы URI/методов, echo upstream credential probe, preflight, read rate limit | 61 проверка прошла |
| Одновременный live | 5 соединений/IP, шестое отклоняется; UI-соединение закрывается при отключении |
| SMTP → public UI → VERIFY/RESET/«Приду» | Пройдено: VERIFY автоматически, RESET и «Приду» явно; guest не получает аккаунтную сессию |
| Existing FULL session + hostile письма | Сессия сохраняется, личные API не вызываются; script/event/template/javascript/data/tracking не исполняются/не загружаются |
| Сроки attendance grant/context | Границы 72 часа/начало и 15 минут сохранены, SQL-проверка без нарушений |
| Штатная private retention | Старое marked письмо удалено worker, unmarked сохранено |
| MailHog restart/maildir + public disable | Письма сохранены, SMTP/operator работают, public 404, существующий WSS завершён |
| Fingerprints вокруг restart/disable | Совпали 24 табличных отпечатка в трёх локальных БД: accounts/пароли/роли, children, passkey entities/credentials, landing/settings, sessions/bookings |
| Существующие local/preview БД и сервисы | Оба data-only dump совпали; IDs/StartedAt 10 посторонних контейнеров прежние; пользовательский SSH listener18027 не останавливался |
| Source boundary | backend/, frontend/app/, api/openapi.json неизменны по исходному snapshot; base compose/shared Nginx идентичны исходным |
| Сборка UI без info/React/backend | Чистая offline-сборка совпала с пакетом, vendor checksums проверены |
| Config/build | Nginx -t enabled/disabled/base/overlay/shared edge; Compose default/overlay preflight; Linux/amd64 package build прошли |
| Typecheck/format/syntax | TypeScript, Prettier затронутых tests/config, Python compile, shell syntax прошли |
| OpenSpec | `openspec validate expose-mailhog-test-preview --strict` прошёл |

Итоговые локальные результаты (игнорируются Git):
`runtime-data/mailhog-public-test/browser-final.log`, `regression-final.log`,
`performance.log`, `policy-final.log`, `policy-results.json`, `retention-results.json`,
`ttl-results.json`, `fingerprints.json`/`fingerprints.log`, `preservation-results.json`,
`typecheck.log`, `format.log`. Исходный snapshot — `runtime-data/mailhog-public-baseline/`.
Повторяемые проверки находятся в scripts/verify-mailhog-public*.py и
frontend/tests/mailhog-public.spec.ts; отдельный guarded Playwright config разрешает
только локальный HTTPS-стенд. Ранние ошибки конфигурации и гонки тестовых fixtures
исправлены; выше перечислены итоговые успешные запуски, не сумма повторных попыток.

Новые backend integration tests не добавлялись и прежние 54 не объявляются повторно
пройденными: backend и application frontend не изменялись. Проверена фактическая
интеграция существующих production-сборок на отдельной синтетической БД.

## Пакет и ограничения

Независимый пакет `artifacts/mailhog-public-1.0.0/` содержит public image Linux/amd64,
аддитивный Compose overlay, только новые public proxy/shared snippets, runbook,
IMAGE/SHA256SUMS. Проверка checksums прошла. Image config ID:
`sha256:864e9117ed8366b629faa44ccc7e0c142319ae013cc89fe11d3d27adcfde8e5f`.
Генератор пакета — `scripts/package-mailhog-public.sh`. Backend/frontend images,
миграции, секреты и обновление auth в пакет не входят.

Закреплены исходные embedded assets MailHog v1.0.1, SHA256 и лицензии upstream и
встроенных библиотек (включая GPLv2 strutil.js). Image содержит лицензии и исходный JS.
У pinned MailHog/maildir API списка игнорирует start/limit, а search даёт неверный total:
публичная адаптация сортирует и фильтрует полный список в UI. Подробности реализации —
infra/mailhog-public/README.md; [upstream maildir](https://github.com/mailhog/storage/blob/master/maildir.go).
Это профиль небольшого тестового inbox, JSON растёт с его объёмом; для большого
архива потребуется отдельное решение. Internal storage/retention не модифицированы.

Ящик и recovery-ссылки публичны, включая тестовые ADMIN. Read-only не защищает
аккаунты, доступные через такие ссылки. Отключение не отзывает уже скопированные
ссылки. Для реальных клиентов preview должен быть выключен.

Сервер не подключался и не изменялся; его текущая доступность этой проверкой не
подтверждается. Будущая поставка и rollback требуют отдельного поручения и серверной
приёмки по docs/mailhog-public-operations.md. Локальный стенд после проверок остановлен
без удаления volumes; существующие сервисы и туннель оставлены работающими.
