# Историческая инструкция V9 — до смены концепции

Сохранена 23.10.2026 как история. После V10/V11 прежние auth/почтовые сценарии
и откат старой парой несовместимы. Действующий runbook — [admin-concept-operations.md](../admin-concept-operations.md).

# Поставка и перенос Ласточки

Актуальная политика: публичный лендинг и расписание, модальный вход/регистрация;
email/пароль подтверждённого аккаунта дают FULL, WebAuthn доброволен для всех ролей.
Общий Basic Auth снят при поставке 0.3.0 после проверки нового приложения.

Это runbook тестовой среды. Реальная почта RuSender и production-релиз
в MVP не включены. **23.10.2026 работают backend 0.7.0/frontend 0.6.1**, БД V9, публичный mail UI 1.0.1.
[Последняя поставка backend и откат](2026-10-23-backend-refactoring.md);
[предыдущая поставка frontend/русских подсказок](2026-10-23-russian-feedback.md).
Отдельно опубликован общий [MailHog без пароля](https://play-and-say.ru/lastochka/mail_hog_test/):
[поставка, сохранность и отключение](2026-10-23-mailhog-public-preview.md).
Закрытый операторский API/SSH-туннель сохранён. Дальнейшие шаги ниже — инструкция
для повторных поставок, а не невыполненная задача.

Все 9 завершённых изменений OpenSpec архивированы 23.10.2026; действующие
требования находятся в `openspec/specs/`, актуальная сводка —
[состояние проекта](../project-status.md). Новая поставка при закрытии архива не выполнялась.

## Проверенный общий сервер

Read-only проверка 19.10.2026: x86-64, 1 CPU, 1967 MiB RAM, доступно около
1175 MiB; swap отсутствует. На корневом диске доступно около 18 GiB.
Это моментальный снимок, перед поставкой повторить `scripts/server-preflight.sh`.
На момент исходного preflight Docker отсутствовал. При поставке установлены
Ubuntu docker.io 29.1.3 / docker-compose-v2 2.40.3; отдельные Lastochka services
запущены, конфигурация/БД сохранены в /opt/lastochka. После запуска доступно
около 653 MiB RAM; контролировать текущую память перед каждой поставкой.

SSH alias `repairdevice-selectel` ведёт на нужный IP с отдельным ключом.
Не переносить ключи, пароли или их содержимое в этот репозиторий.
Nginx уже обслуживает маркетинговый `/` и RepairDevice `/repair_demo/`;
оба маршрута вернули 200, `nginx -t` успешен. SHA256 исходного vhost:
`e3406d68261ea2a98730d4d7c3817673b5e89e420836dc3c33a9c127ce465a10`.
Host-порты 18080/18026 были свободны. Backend RepairDevice использует host 8080:
Lastochka **не** публикует свой 8080, PostgreSQL или Node на host.

## Артефакты собираются на рабочей машине

Java 25, Node 24, Docker/Compose; из корня:

```sh
scripts/build-release.sh 0.3.0
```

По умолчанию целевая платформа `linux/amd64`. Изменять через TARGET_PLATFORM
только после проверки архитектуры будущего сервера. Gradle/Vite компилируют код
локально. Dockerfile упаковывает JAR или готовые SSR/client bundles; frontend
stage устанавливает только runtime npm-зависимости. На сервере нет сборки.
Сначала обновить сохранённый OpenAPI (`README.md`) и проверить отсутствие drift.

Результат `artifacts/release-VERSION/`: два образа в сжатом Docker archive,
метаданные image ID/architecture и SHA256 manifest, Compose и proxy configs.
Для registry поставки пушить два образа с независимыми immutable tags и использовать
`image@sha256:...`; для archive сверить SHA256 до `docker load`, затем image IDs.
Не считать Docker image ID digest опубликованного registry manifest.
Инфраструктурные образы PostgreSQL/MailHog/Nginx также скачать заранее и проверить
для amd64; production-поставка должна зафиксировать их digest в release manifest.

Последняя поставка 23.10.2026: **backend 0.7.0/frontend 0.6.1**, V9,
календарь и «Приду» включены. Все 9 аккаунтов, 1 ребёнок, бизнес-данные и 3 письма
сохранены; [публичная приёмка и откат](2026-10-23-backend-refactoring.md).
Публичный почтовый UI 1.0.1 включён по отдельному разрешению, операторский API
остаётся закрытым; реальная доставка не подключена. При обычном откате бинарника
0.7.0→0.6.1 схема/ключи/generation сохраняются. Disaster restore БД требует
новой внешней generation по [attendance runbook](../calendar-attendance-operations.md).

## Подготовка и запуск закрытого preview

1. Повторить preflight; согласовать доступную память с владельцем общего сервера.
   Никаких `down`/перезапусков других проектов. Создать отдельную директорию,
   пользователя/права, Compose project `lastochka-preview` и backup storage.
2. Скопировать release и конфигурации с сохранением структуры `infra/` относительно
   Compose. Сверить manifest, загрузить готовые образы (`docker load`). Исходники,
   `info/`, Node/Gradle tooling на сервер не копируются.
3. Создать `.env.preview` из `.env.preview.example`, режим 600, случайный пароль БД.
   Для сервера: PUBLIC_APP_URL=https://play-and-say.ru/lastochka/,
   WEBAUTHN_ORIGIN=https://play-and-say.ru, WEBAUTHN_RP_ID=play-and-say.ru,
   COOKIE_SECURE=true; явно указать версии обоих образов.
4. Сохранить backup существующего Nginx vhost и проверить исходные `/`,
   `/repair_demo/`, ACME и сертификат. При добавлении Docker не включать новые
   публичные порты. Compose bind только 127.0.0.1: 18080 и 127.0.0.1: 18026.
5. Запустить только PostgreSQL/MailHog/mailhog-access. Перед новой версией БД
   выполнить `pg_dump -Fc`, отдельно сохранить maildir volume и защищённую env.
6. Для первоначального тестового набора доступен bootstrap
   `--lastochka.preview.seed=true --server.port=0` с LASTOCHKA_TEST_PASSWORD
   через секретный env-файл: создаёт семь подтверждённых аккаунтов без ключей.
   Работает только в preview; конфликт существующего набора откатывает транзакцию,
   одинаковый повтор не перезаписывает данные. После создания секретный env удалить.
   Для отдельного нового ADMIN до основного backend создать ADMIN через последовательные одноразовые запуски
   образа с `--lastochka.admin.create=true --server.port=0` и переменными
   LASTOCHKA_ADMIN_EMAIL, LASTOCHKA_ADMIN_NAME, LASTOCHKA_ADMIN_PASSWORD. Передавать
   их через защищённый env-файл/секрет, не аргументы CLI. Первый запуск также
   выполнит Flyway. Нет стандартного пароля и повышения роли API. На сервере 2 GB
   не запускать вторую JVM bootstrap одновременно с основным backend. Добавление
   ADMIN позже выполнять в окно остановки только Lastochka backend, затем вернуть
   его и проверить readiness. Каждый ADMIN может добровольно привязать собственный passkey.
7. Запустить основной backend. Flyway выполняется одним процессом перед frontend.
   Проверить `/lastochka/actuator/health` из Compose network и состояние container.
   Только совместимые добавочные миграции допускают откат старого бинарника.
8. Запустить frontend, затем proxy. Проверить внутренние readiness и
   `http://127.0.0.1: 18080/lastochka/`, assets и refresh deep links.
9. Добавить **только locations** из `infra/shared-server-lastochka.conf` в текущий
   HTTPS server. Общий Basic Auth для Lastochka должен быть выключен; доступ
   к личным API ограничивает backend. Проверить
   `nginx -t`, затем reload согласно runbook общего сервера. Не менять root proxy,
   RepairDevice, ACME, сертификаты и существующее ограничение TLS 1.2.
10. В чистом браузере без Authorization проверить открытие лендинга/модальных
    форм и запрет личных API гостю, парольный вход без passkey для всех ролей.
    Проверить HTTPS, `/lastochka` redirect с query, SSR/metadata, assets/lazy chunks,
    отдельную cookie Path=/lastochka, Secure/HttpOnly, CSRF и WebAuthn RP/origin.
    `/lastochka/api/unknown` должен вернуть API 404, не HTML. Проверить root и
    RepairDevice повторно и сравнить со снимком. Физические устройства WebAuthn
    проходят отдельную приёмку; виртуальный аутентификатор её не заменяет.

## MailHog

SMTP доступен backend по внутренней сети `mail`, UI/API только через loopback
18026 и SSH-туннель, например `ssh -L 18026: 127.0.0.1: 18026 repairdevice-selectel`.
На текущей рабочей машине 18026 занят локальным Docker: для серверных писем
использовать `ssh -N -L 127.0.0.1: 18027: 127.0.0.1: 18026 repairdevice-selectel`
и открыть `http://127.0.0.1: 18027/`. Терминал с туннелем оставить открытым.
Статус Connected зависит от WebSocket `/api/v2/websocket`: mailhog-access должен
передавать Upgrade/Connection и не буферизовать поток. HTTP 400 handshake при
работающем `/api/v2/messages` означает сбой живого соединения, а не потерю писем.
23.10.2026 исправление применено отдельным config-release
`/opt/lastochka/releases/mailhog-websocket-20261023/` только к mailhog-access;
следующие поставки должны сохранять исправленный `infra/mailhog-access.conf`.
У MailHog нет выхода во внешнюю сеть, даже через native Release. Дополнительный
Nginx передаёт только входящие запросы. Это не application API, доступ ADMIN
приложения сам по себе не открывает MailHog. Не проксировать операторский API наружу. Для отдельно разрешённого публичного
просмотра использовать действующий ограниченный public overlay; сохранять его
конфиги при поставке приложения, подробности — в отчёте публичной почты выше.
Проверить версию v1.0.1 и amd64 image digest, долговечность maildir после restart.
Удаление тестовых писем выполняется native UI/API только оператором; сначала
убедиться, что ссылки текущих сценариев больше не нужны.

Статус outbox CAPTURED означает приём MailHog, а не доставку адресату. Claim/lease
сохраняются в PostgreSQL; после аварии возможна повторная SMTP-копия со стабильным
Message-ID. Это не повторное изменение записи. После пяти явных ошибок FAILED;
исследовать eventId/attempts/last_error, не выводить body/token в журналы.
Подключение RuSender позже требует HTTPS-адаптер, токен, активный ключ отправки,
верифицированный отправитель и отдельную проверку принятия/доставки.

## Независимый rollout и rollback

Для проверенной frontend-сборки отдельно от backend:

```sh
npm --prefix frontend run typecheck
npm --prefix frontend run build
scripts/package-frontend-release.sh 0.4.0
```

Пакет `artifacts/frontend-release-0.4.0/` содержит только frontend image,
image ID/architecture, SHA256 manifest и шаблоны Compose/proxy. Проверить manifest
перед загрузкой, сохранить фактические env/proxy и свежий pg_dump; backend tag
в рабочей env оставить прежним. Изменить только FRONTEND_IMAGE, выполнить
`up -d --no-deps --wait frontend`, затем пересоздать только собственный proxy
для обновления DNS. APP_VERSION встроена в образ и видна во внутренних probes.
Отчёт 0.4.0: [движение и запись](2026-10-20-landing-refinement.md).

Приёмка обязательно кликает React Router Link в production runtime: запросы
`/lastochka/*.data` должны дойти до маршрутизатора. Один прямой GET страницы
не проверяет навигацию. Неизвестные маршруты/файлы возвращают 404; assets
не подменяются HTML. Старый frontend 0.3.0 содержит известную ошибку .data:
откат восстанавливает его доступность, но также возвращает эту ошибку.


Сначала backup, затем совместимый backend при старом frontend; после проверки —
новый frontend. Контракт 0.1 совместим внутри MVP: старые операции/поля не удаляются.
Новый frontend требует API 0.1 с сессиями, CSRF, LandingContent schemaVersion=1.
Breaking change требует новой API-версии и периода поддержки обоих клиентов.
Образы версионируются независимо; `docker compose up -d --no-deps backend` или
`frontend` меняет только выбранный сервис. Recreate proxy, если изменился IP
upstream и Nginx не обновил Docker DNS. Проверить readiness до публичного трафика.

Frontend сохраняет hashed assets в отдельном public-assets volume. Открытые
вкладки получают старые chunks при rollout. Не очищать volume во время окна
совместимости; удалять только assets старше согласованного максимального срока
жизни вкладки и вне хранимых rollback-релизов. HTML не кэшируется proxy.

Для rollback указать предыдущий образ выбранного сервиса и пересоздать только его.
Не выполнять `down -v`. Сессии, credentials, семьи, расписание, контент и outbox
лежат в PostgreSQL. Откат схемы — отдельная процедура из backup в НОВУЮ БД;
не запускать старый backend против несовместимой миграции. Если добавлялся только
Lastochka location, откат vhost из backup не меняет другие сервисы.
Unhealthy readiness не вызывает автоматический restart: при недоступности БД/API
исправляется зависимость, liveness остаётся независимым.

## Перенос на рабочий сервер и Kubernetes

Проверить архитектуру, Java/Node в образах, диски, TLS/DNS, backup restore.
Для согласованного переноса остановить новые записи на старом ingress, дождаться
завершения запросов и graceful stop **backend worker**, сделать последний pg_dump
и копию maildir, проверить checksum. Восстановить в отдельные volumes/БД нового
сервера, запустить один backend, затем frontend, проверить синтетические записи,
аудит, сессии, ключи и outbox. До переключения DNS новый backend не должен получать
реальные команды одновременно со старым. При ошибке оставить новый ingress
закрытым и вернуть старую сторону, учитывая уже принятые после переключения записи.
Нельзя бесконтрольно включить обе копии с независимыми БД/outbox.

При сохранении https://play-and-say.ru и RP ID passkey сохраняются независимо от
смены IP/контейнеров. Изменение path требует пересборки frontend с APP_BASE_PATH,
согласованной cookie/context path и URL писем. Смена домена/RP ID делает старые
passkey недоступными на новом origin. При добровольном WebAuthn пользователь
входит на новом origin с подтверждённым email и паролем и при желании добавляет
новый ключ. Старые credentials не удаляются автоматически. Email-ссылка сама
по себе не создаёт полноценную сессию. Перенос домена остаётся отдельной операцией.


В Kubernetes два Deployment/Service (backend/frontend), Ingress с тем же prefix,
внешние PostgreSQL/секреты, отдельные probes и ресурсы. Никакого sticky state или
локальных credential-файлов. Миграции — единственный Job перед rollout;
mail/outbox worker требует DB lease. Kubernetes manifests сейчас не создаются.

### Русские подсказки — 0.6.1

Поставка `localize-user-hints-in-russian`, сохранность исходных аккаунтов/писем,
публичная приёмка и откат описаны в
[отчёте 23.10.2026](2026-10-23-russian-feedback.md).
