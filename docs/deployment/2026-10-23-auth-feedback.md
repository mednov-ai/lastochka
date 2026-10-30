# Автоматическое подтверждение email и ошибки — поставка 0.6.0

23.10.2026 по отдельному поручению пользователя на
https://play-and-say.ru/lastochka/ поставлены **backend 0.6.0 / frontend 0.6.0**,
миграция **V9**. Все **9 исходных аккаунтов**, роли/хеши/ключи/бизнес-данные и
**3 исходных письма** сохранены. Публичный MailHog продолжает работать по
https://play-and-say.ru/lastochka/mail_hog_test/ без пароля, включая Connected/live.

Полная email-ссылка автоматически выполняет CSRF POST VERIFY; после успеха
кнопки подтверждения нет. Повтор в исходном TTL безопасен, ссылка не выполняет вход.
Новый пароль — 6–128 Unicode code points, хотя бы буква L и цифра Nd, одинаково
на backend/frontend. Старые пароли не получают новой проверки сложности при входе.
Ошибки приходят из messages.properties через advice/Security и показываются
исчезающей плашкой справа внизу, в том числе внутри native dialog.

## Подготовка и состав поставки

До начала подтверждены backend/frontend 0.5.0, V8, 9 аккаунтов, 0 детей/занятий/
записей и 3 письма. Учитывались действующие public/operator MailHog proxy releases.
Серверные bootstrap/seed не запускались, пароли/роли старых пользователей не менялись.

Backup: `/opt/lastochka/backups/pre-0.6.0-20261023T162809Z/` (700; env/dump/state 600).
Сохранены БД, maildir, рабочая env, Compose/public overlay, все привязанные конфиги,
shared Nginx vhost/snippet и исходные табличные отпечатки. Dump восстановлен в
отдельную временную БД и сверен по исходным столбцам; временная БД удалена.
Maildir archive прочитан и сверены имена/SHA256 файлов. Рабочая БД не заменялась.

Готовые Linux/amd64 образы собраны локально из ранее принятого auth JAR и frontend
production bundle, без изменения application source/OpenAPI. JAR совпал с ранее
принятым локальным бинарником побайтно. На сервере только проверка manifest и docker load;
сборки, npm install, миграций вручную и импорта seed не было.

| Артефакт | Проверенный идентификатор |
|---|---|
| Backend image ID | `sha256:700b870f981f87cadbf8060ababa3822aac932136319e6808648393d839a3902` |
| Frontend image ID | `sha256:fa6d076fe9053955e0b6e92404ee86a405c6cd9e504a10d131c81216a7b4deee` |
| JAR SHA256 | `948ab90411a1998b02d6032c45a7d7af0363886895dfb7dd166d4ee21e5e5e24` |
| application-images.tar.gz SHA256 | `affe1f49c105f59a4605b2fbd276d309f8db69b0b4849d6b76ca6abada0a0e2f` |
| Runtime | Temurin 25.0.4.1+1, Node 24.22.1 |

Image ID — идентификатор загруженного Docker image, не registry release digest.
Архив 254407965 bytes, package `/opt/lastochka/releases/0.6.0/`.

До серверной поставки оба amd64 image реально запущены локально на собственной
временной БД: backend readiness, frontend readiness/version 0.6.0 и SSR прошли.
Дополнительный rollback gate на отдельном локальном PostgreSQL подтвердил
V8→V9, запуск прежнего backend 0.5.0 на V9, вход старым паролем без цифр и новым
шестисимвольным паролем после отката, неизменность исходного хеша и возврат 0.6.0.
Старый JAR совпал с `/app/app.jar` image 0.5.0. Временные БД/контейнеры удалены,
отдельный local PostgreSQL остановлен. Рабочие/чужие локальные сервисы не использованы.

## Фактический rollout

1. Рабочая `/opt/lastochka/shared/.env.preview` сохранила все прежние параметры,
   кроме BACKEND_IMAGE/FRONTEND_IMAGE. Attendance generation/keyring не менялись.
2. Использовались существующий Compose
   `/opt/lastochka/releases/mailhog-websocket-20261023/compose.preview.yaml`
   и действующий public overlay
   `/opt/lastochka/mailhog-public/current/compose.mailhog-public.yaml`, с обеими env.
   **Конфиги proxy из нового application package не применялись**: публичный
   MailHog и operator config обязаны сохранить свои актуальные mounts.
3. Пересоздан только backend с новым image, Flyway применил V9. Затем пересоздан
   только собственный preview proxy для обновления upstream DNS.
4. Прежний frontend на новом backend прошёл настоящие register→SMTP→manual verify,
   повтор VERIFY и password login. Проверочный аккаунт/письмо удалены точечно;
   данные снова сверены с исходными до следующего этапа.
5. Пересоздан только frontend, затем собственный proxy. Volume public-assets сохранён.
   Вкладка, открытая до frontend rollout, получила прежний asset и перешла на
   расписание через route data без page errors.
6. Пройдена публичная HTTPS-приёмка нового поведения. PostgreSQL, MailHog,
   operator proxy и public proxy имеют прежние container ID/image/StartedAt/mounts.
   Shared Nginx не перезапускался/не перенастраивался, его файлы и TLS/ACME прежние.

## Серверная приёмка

`scripts/remote-auth-feedback-acceptance.mjs` выполнял отдельные guarded режимы:
5 проверок old-frontend compatibility, 2 проверки старой вкладки и 58 assertions
нового сценария (включая проверки тестовых Unicode-векторов). Только собственные
аккаунты с уникальным `auth-deploy-…` prefix; не использовались пароли старых аккаунтов.

- UI не отправляет пароль без цифры; прямой API независимо отклоняет 5 символов,
  только буквы, только цифры и 129, возвращая 400/VALIDATION_ERROR, конкретное
  fieldErrors.password, problem+json и requestId.
- Шестисимвольная регистрация через форму и настоящее SMTP-письмо. Две вкладки
  автоматически отправляют по одному защищённому POST, показывают успех без
  submit-кнопки. Fragment удалён, секрет не попадает в request URL/storage.
  VERIFY не создаёт парольную сессию; повтор ссылки успешен до исходного expiry.
- Вход с шестисимвольным паролем работает. Safe next корректно возвращает
  пользователя к расписанию. Подтверждение другого адреса сохраняет текущий FULL-вход.
- Потеря HTTP-ответа после успешного commit: одна плашка и явный retry, который
  завершает страницу успехом без повторного бизнес-действия.
- Backend принимает 128 code points, включая 127 supplementary букв и арабскую Nd,
  и затем принимает этот пароль при входе. Дополнительная форма реально отправила
  тот же валидный 128-code-point пароль, а 129 отклонила до запроса. Кириллица принята.
  4 VERIFY receipts были consumed, проверка исходного TTL 24h без нарушений.
- Открытие RESET не выполняет смену пароля; слабый API reset не расходует токен и
  сохраняет прежний вход. Явный reset устанавливает новый шестисимвольный пароль,
  повтор использования RESET отклонён.
- Настоящая backend-ошибка входа в auth dialog при 375/768/1440 видна над backdrop,
  без overflow, доступна кнопка закрытия, повторная попытка показывает новую плашку.
  Скриншоты 375/1440 осмотрены. Reduced-motion включён в этой матрице.
- Реальная ошибка недействительной VERIFY-ссылки исчезает через 6 видимых секунд;
  постоянное состояние страницы остаётся. Hover сохраняет плашку дольше 6 секунд.
  No-JS guidance читается. Ограниченная страница «Приду» показывает ошибку без
  auth bootstrap/автоматического ответа; её действие не стало VERIFY.
- Публичный MailHog Connected, управляющий API остаётся закрытым. Дополнительный
  backend RESET email появился в уже открытом MailHog без reload после rollout.
- Security 401 сохраняет каталогизированный problem contract. Backend logs не
  содержат секретных fragment-ссылок и проверочных паролей.

Предварительные отказы были ошибками проверочного сценария: сравнение текста
«не менее» вместо фактического «минимум», неверное ожидание кабинета вместо safe
next=/schedule и выбор отсутствующего script src вместо stylesheet старой вкладки.
Для повторного запуска удалялись только собственные fixtures. Приложения ради
приёмки не исправлялись; выше перечислены итоговые успешные результаты.
Проверка native rollback сначала ожидала общий health при выключенном SMTP;
исправлена на readiness (как реальный container healthcheck), после чего прошла.

## Сохранность и очистка

Все 9 исходных аккаунтов, хеши/роли, user/passkey entities и контент сохранены.
Побайтно совпадают 14 полных табличных отпечатков исходных столбцов:
accounts, children, user_credentials, user_entities, landing_content, studio_settings,
studio_sessions, bookings, auth_tokens, notification_outbox, audit_events,
attendance_grants, move_previews, idempotency_records.

В исходной attendance_contexts было 0 строк. Проверка недействительной ссылки
«Приду» закономерно создала 1 новый анонимный ограниченный контекст без grant,
с TTL≤15min; он не даёт доступа к записи/аккаунту. Этот операционный контекст
сохранён до штатной очистки, не удалялся по предположению о владельце. Проверка
сохранности явно отличает его добавление от изменения/удаления исходных данных.
Анонимные HTTP-сессии и IP rate buckets также продолжают обычный срок жизни.

Проверочные аккаунты (4 в итоговом новом сценарии, отдельный compatibility fixture
и fixture предварительного прогона) удалены с их токенами/outbox/аудитом/сессиями
транзакционно по точному уникальному prefix. Собственные email rate buckets убраны;
общие IP limits не сбрасывались. Удалены только письма соответствующих fixtures,
с запретом удаления любого исходного mail ID. Состав и SHA256 всех 3 исходных писем
точно совпадают с backup, лишних проверочных писем нет. Seed/массовый DELETE inbox,
down -v и замена пользовательских данных не выполнялись.

`/` и `/repair_demo/` вернули 200 и прежний SHA256; application readiness healthy,
`nginx -t` прошёл, certbot.timer active. Публичный MailHog включён, private operator
конфиги/ports прежние. Пользовательскими SSH-туннелями эта поставка не управляла.

Итоговый dump: `/opt/lastochka/backups/lastochka/ready-for-testing-0.6.0-20261023.dump`
(600), оглавление pg_restore проверено. После восстановления БД attendance требует
новой внешней generation по существующему runbook; ключи не находятся в dump.

Локальные доказательства вне Git:
`runtime-data/server-deploy/auth-0.6.0/`, `artifacts/server-deploy/auth-0.6.0/`,
`artifacts/release-0.6.0/`. Source boundary подтвердил, что application source и
OpenAPI во время поставки не менялись. Параллельный план `localize-user-hints-in-russian`
в AGENTS.md сохранён и в эту поставку не включён. Прежние 54 backend/46 local browser
результатов описаны в [локальном отчёте](../auth-verification-and-error-feedback.md),
они не объявляются повторно выполненными серверными тестами. OpenSpec архивирован 23.10.2026; требования синхронизированы.

## Откат без замены данных

Самый узкий откат UI — установить только FRONTEND_IMAGE=lastochka-frontend:0.5.0
в рабочей env, пересоздать только frontend и затем proxy. Новый backend совместим
со старой ручной формой VERIFY, что проверено и локально, и на сервере до UI rollout.

Для полного отката указать BACKEND_IMAGE=lastochka-backend:0.5.0 и
FRONTEND_IMAGE=lastochka-frontend:0.5.0 в той же env. С теми же двумя Compose/env:

```sh
docker compose -p lastochka-preview \
  --env-file /opt/lastochka/shared/.env.preview \
  --env-file /opt/lastochka/mailhog-public/shared/public.env \
  -f /opt/lastochka/releases/mailhog-websocket-20261023/compose.preview.yaml \
  -f /opt/lastochka/mailhog-public/current/compose.mailhog-public.yaml \
  up -d --no-deps --wait backend frontend
```

После изменения upstream пересоздать только proxy тем же вызовом с
`up -d --no-deps --force-recreate proxy`. Проверить health, старую вкладку,
password login, соседние сайты и MailHog Connected. V9/receipts не удалять,
не выполнять down-migration, reset паролей или restore старого dump поверх новых
данных. Прежний backend на V9 и шестисимвольный login после отката проверены локально;
live rollback на пользовательском сервере не выполнялся и не потребовался.
Старый UI/backend возвращают прежний ручной VERIFY и политику установки новых паролей.
