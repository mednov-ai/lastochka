# Публичный тестовый MailHog

## Адрес и границы

По отдельному поручению 23.10.2026 опубликован адрес; клиент открывает
**https://play-and-say.ru/lastochka/mail_hog_test/** без пароля и SSH.
Вариант без завершающего `/` перенаправляется 308 с сохранением query.
Серверная приёмка и проверенный откат —
[отчёт поставки](deployment/2026-10-23-mailhog-public-preview.md). Локальный стенд: https://localhost:5445/lastochka/mail_hog_test/.
Самоподписанный сертификат существует только в локальном runtime-data.

Это общий публичный ящик, все прежние и новые письма видны каждому посетителю.
Ссылки VERIFY/RESET/«Приду» сохраняют полномочия и исходный срок жизни. Через RESET
можно получить соответствующий тестовый аккаунт, включая ADMIN. Read-only означает
запрет управления MailHog, а не защиту этих аккаунтов. Использовать только
синтетические данные. Отключение ящика не отзывает уже скопированные ссылки.
Для реальных клиентов необходима отдельная доставка RuSender и выключенный preview.

Не меняются SMTP `mailhog:1025`, закрытый root API `http://mailhog:8025`, retention,
maildir/volume, аккаунты/пароли/passkey приложения. Публичный UI не вызывает API
приложения, не исполняет HTML писем, не показывает вложения/HTML-документы.
Plaintext и HTTP(S)-ссылки доступны. Список/поиск/страницы сортируются в UI:
закреплённый MailHog v1.0.1 с maildir возвращает весь список независимо от limit,
а поиск неверно считает total. Это профиль небольшого тестового ящика; размер
JSON списка растёт с inbox, лимит HTTP не является ограничением его размера.
Не накапливать большой архив. Штатная retention удаляет только помеченные старые
attendance-письма; остальные письма очищает оператор по прежним правилам.
Операторский UI/API через loopback/туннель сохраняет полные возможности.

## Конфигурация и локальная проверка

По умолчанию `MAILHOG_PUBLIC_PREVIEW_ENABLED=false`: весь подпуть, включая UI,
assets/API/WS и вариант без `/`, отвечает 404. Для включения одновременно нужны
`true`, `LASTOCHKA_ENVIRONMENT=test-preview`, `MAILHOG_PUBLIC_ORIGIN=https://host`.
Включение в production и origin без HTTPS отклоняются до старта Nginx.
Имя среды — защита от ошибки настройки, не механизм авторизации.

Внешний shared Nginx и preview proxy передают WebSocket Upgrade/Connection,
не буферизуют, timeout 1 час. Отдельный mailhog-public не публикует порт и доверяет
X-Real-IP только внутренним/loopback прокси; внешний edge перезаписывает этот
заголовок. Не публиковать внутренние порты. Cookie/Authorization удаляются перед
MailHog, Set-Cookie блокируется в ответе. Ограничения: 20 чтений/сек/IP + burst100,
5 live/IP и 100 live всего. Логи публичного сервиса содержат только статус/метод,
Docker rotation 10MB ×3; исключить подпуть из access/error request logs всех edge.
CSP/no-store/no-referrer/noindex/nosniff действуют также для ошибок.

Локально (только отдельный Compose project, без чужих volumes):

```sh
python3 scripts/build-mailhog-public.py infra/mailhog-public/build
# Подготовить локальные TLS/edge-файлы:
python3 scripts/setup-mailhog-public-test.py
docker compose -f compose.mailhog-public-test.yaml build mailhog-public
MAILHOG_PUBLIC_PREVIEW_ENABLED=true docker compose -f compose.mailhog-public-test.yaml up -d --wait
python3 scripts/local-mailhog-public-preview.py start
python3 scripts/verify-mailhog-public.py
cd frontend
TEST_APP_URL=https://localhost:5445/lastochka TEST_MAILHOG_URL=http://127.0.0.1:18101 npx playwright test --config=playwright.mailhog-public.config.ts mailhog-public.spec.ts calendar-attendance.spec.ts auth-feedback.spec.ts landing.spec.ts routing.spec.ts
```

Требуются Java25/Node24/Python3/Docker и собранные текущие локальные JAR/SSR.
Изолированные порты: БД55435, SMTP11101, operator18101, backend8186, frontend3020,
HTTP5180/HTTPS5445. Helper останавливает только собственные PID с проверкой команды.
Почтовые тесты перед запуском очищают только новый test inbox, календарная регрессия — только
`mailhog_public_test`. Не направлять их на сервер/обычную локальную БД.
После проверки остановить helper и этот Compose project, сохранив volumes.

## Порядок отдельной повторной поставки

1. Локально `scripts/package-mailhog-public.sh 1.0.0` создаёт Linux/amd64 image,
   аддитивный compose.mailhog-public.yaml/config/snippets, manifest/checksums и инструкцию в `artifacts/mailhog-public-1.0.0`.
   Пакет не содержит JAR, frontend image, миграций, backend env или ключей.
2. По новому поручению сначала read-only проверить текущие пути Compose/конфигов,
   env/image IDs, root/repair_demo/Lastochka/API, loopback operator и данные.
   Сохранить приватный backup текущего Compose/Nginx/env и maildir/volume, проверить
   его чтение; посчитать fingerprints аккаунтов/хешей/ролей/passkey/контента/записей.
   Не печатать email-тела, bearer-ссылки, ключи и секреты. Не менять их ради демонстрации.
3. Загрузить только public image с проверкой SHA256. Новые конфиги разложить в
   отдельный `/opt/lastochka/mailhog-public/releases/1.0.0`, сохранить прежние config
   pointers. `/opt/lastochka/mailhog-public/current` указывает только на этот пакет,
   не на auth/application release. Сопоставить Compose project/volume names с
   текущими; не запускать весь стек и не подменять действующий `.env` шаблоном.
4. Использовать существующий Compose как первый `-f`, а `compose.mailhog-public.yaml`
   как второй `-f` с `MAILHOG_PUBLIC_CONFIG_ROOT=/opt/lastochka/mailhog-public/current`.
   Overlay задаёт только mailhog-public и mounts proxy, без application services.
   Добавить public-route
   mount в существующий proxy и две узкие mail_hog_test location из `shared-mailhog-public-locations.conf` перед `/lastochka/`.
   Базовый Compose не требует public image: штатный proxy возвращает явный 404.
   Overlay монтирует `preview-proxy-mailhog.conf` с маршрутом к public service.
   Shared include указывает на отдельный mailhog-public/current/infra. Backend,
   frontend, mailhog-access и mailhog конфигурации/образы остаются существующими.
   Включить public flag только в тестовой среде и задать HTTPS origin/image.
   Проверить `docker compose ... config --quiet`, `nginx -t` обоих прокси до reload.
5. Запустить **только** mailhog-public (`up -d --no-deps mailhog-public`), пересоздать
   **только** preview proxy с новым mount/config; shared Nginx reload после nginx-t.
   Никогда `down -v`, миграции, seed, recreate backend/frontend или сброс аккаунтов.
6. На настоящем публичном HTTPS проверить чистый браузер/мобильный UI/Connected,
   SMTP без refresh, безопасный текст/ссылки, запреты прямых API, заголовки, neighbors,
   fingerprints и сроки исходных ссылок. Не использовать реальные аккаунты для теста.
   Реальная серверная приёмка — отдельный отчёт; локальная её не заменяет.

## Отключение и rollback

Сохранить env, установить `MAILHOG_PUBLIC_PREVIEW_ENABLED=false` и выполнить
`up -d --no-deps --force-recreate mailhog-public` **с тем же Compose project/env**.
У сервиса SIGTERM: прежний процесс и все WSS закрываются. Один shared Nginx reload
не гарантирует завершения старых WSS. Проверить 404 UI/assets/API/WS, прекращение
старого live и продолжение внутреннего SMTP/operator; maildir не удалять.
Это основной быстрый rollback: отдельный disabled public proxy остаётся работающим,
поэтому приложение не подхватит подпуть и не вернёт SSR/502.

Для отката версии public image — оставить flag=false, вернуть прежний public image
и совместимые public configs, пересоздать только mailhog-public; проверить 404 и
соседние маршруты. При откате маршрутов убрать только две узкие public location и
вместо них оставить явные 404 на обоих прокси (иначе подпуть попадёт в SSR).
`nginx -t` перед reload. Полный backup shared config не накатывать поверх новых
изменений соседних сайтов. Данные/volumes и application images не откатываются.
