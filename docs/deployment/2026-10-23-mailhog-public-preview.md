# Публичный тестовый MailHog — серверная поставка

23.10.2026 по отдельному поручению пользователя опубликован
**https://play-and-say.ru/lastochka/mail_hog_test/**.
Адрес открывается без пароля, сессии, SSH или секретного параметра.
Вариант без завершающего `/` возвращает 308 с сохранением query.
Общий inbox показывает существующие и новые письма, Connected работает по WSS;
новое SMTP-письмо появляется без обновления страницы.

Поставлен только `expose-mailhog-test-preview`. Backend/frontend остаются **0.5.0**,
БД — **V8**. Auth change `improve-auth-verification-and-error-feedback` не поставлен:
приложения не перезапускались, их image ID/StartedAt и рабочая env не изменились.

## Подготовка и границы

Read-only проверка подтвердила 8 аккаунтов, 0 детей/занятий/записей, 2 письма.
Прежний mailhog-access использовал config-release с WebSocket-исправлением;
его настройки и container ID сохранены. Текущий backend image:
`sha256:55af4e0971476ea164a022abc7ed1f2a889a51c9736661429a1c71ef5b72091c`,
frontend image:
`sha256:2314a19d3c9777a675a2af449d818829fd2acd7f13daec77446464f122665f3b`.

Backup: `/opt/lastochka/backups/mailhog-public-20261023T160303Z/` (каталог 700,
секретные файлы 600). Сохранены application env, Compose и привязанные proxy configs,
shared Nginx snippet/vhost, pg_dump, maildir archive и исходные fingerprints.
Dump восстановлен в отдельную временную БД того же PostgreSQL, отпечатки восьми
таблиц совпали; временная БД удалена. Архив maildir прочитан и побайтно проверен.
Рабочие БД/почтовый volume не заменялись, MailHog не останавливался.

Сервер получил готовый независимый Linux/amd64 пакет с SHA256SUMS. На сервере
проверены все checksums и image ID, сборки и передачи JAR/SSR не было.

- Public release: `/opt/lastochka/mailhog-public/releases/1.0.0/`.
- Public current symlink указывает только на этот release.
- Public image: `lastochka/mailhog-public:1.0.0`, image ID
  `sha256:864e9117ed8366b629faa44ccc7e0c142319ae013cc89fe11d3d27adcfde8e5f`.
- Базовый Compose: `/opt/lastochka/releases/mailhog-websocket-20261023/compose.preview.yaml`.
- Аддитивный overlay: `/opt/lastochka/mailhog-public/current/compose.mailhog-public.yaml`.
- Прежняя env: `/opt/lastochka/shared/.env.preview`, не менялась.
- Отдельная public env: `/opt/lastochka/mailhog-public/shared/public.env` (600),
  `MAILHOG_PUBLIC_PREVIEW_ENABLED=true`, `LASTOCHKA_ENVIRONMENT=test-preview`,
  HTTPS origin `https://play-and-say.ru`.

Нормализованный Compose подтвердил неизменность backend/frontend/postgres/mailhog/
mailhog-access: overlay добавляет только public service и меняет mounts proxy.
Новый сервис сначала запущен выключенным. Inner Nginx проверен на той же Docker-сети,
затем пересоздан только собственный preview proxy. В shared snippet добавлены только
две узкие location; общий vhost, TLS/ACME и остальные маршруты не менялись.
После `nginx -t` выполнен reload shared Nginx. До включения публичный подпуть давал 404.
SMTP, БД, frontend, backend и operator proxy не перезапускались.

## Публичная приёмка

`scripts/remote-mailhog-public-acceptance.mjs` завершил **73 проверки** на настоящем
публичном HTTPS, в чистых браузерах без cookie/Authorization. Он не использует SSH
для доступа посетителя к UI: SSH нужен оператору только для синтетического SMTP
и проверки переключателя, публичные UI/API/WSS запрашиваются напрямую через интернет.

- 200 без пароля; 308 и query; UI/API/assets только по выделенному подпути.
- Connected/WSS, список прежних писем, поиск и текст с кликабельной HTTP(S)-ссылкой.
  Поиск не является границей приватности общего ящика.
- Размеры 375/768/1440, refresh, отсутствие горизонтального переполнения и page errors.
- Диагностическое письмо через настоящий внутренний SMTP появилось без reload;
  браузер получил WebSocket event. Текст содержал только синтетические данные и
  ссылку на обычный лендинг, без аккаунтных токенов.
- Cookie/Authorization не требуются, public UI не вызывает auth/me и не создаёт
  аккаунтную сессию. Проверены no-store/no-referrer/noindex/nosniff/CSP с фактическим WSS.
- Прямые DELETE/POST/PUT/PATCH, Jim/outgoing SMTP/import/release/MIME/download и
  варианты URI отклоняются; исходные письма остаются.
- При открытом UI оператор выключил режим: старый WSS закрыт, bare prefix,
  UI/assets/API/WS дают 404. SMTP/operator и исходные данные сохранены.
  После повторного включения браузер автоматически вернул Connected, новый чистый
  клиент также открыл ящик без входа. Итоговый режим включён.
- Личный API по-прежнему требует вход; прежний лендинг и модальное окно входа работают.

Дополнительная финальная read-only проверка подтвердила операторский HTTP/API и
WebSocket101 на loopback18026, отсутствие host ports у MailHog/public service,
loopback-only operator port, internal mail network, отсутствие bearer-ссылок и
Cookie/Authorization в public logs. Пользовательский SSH listener18027 сохранён.

Локальная приёмка plaintext/HTML/template/tracking инъекций описана отдельно в
[локальном отчёте](../mailhog-public-preview.md); сервер получил тот же проверенный
image ID. Серверный прогон не создавал аккаунты и не менял записи или пароли.
Ранее выполненные 37 локальных browser-сценариев не суммируются с этими 73.

## Сохранность и итог

После удаления только собственного диагностического письма:

- Все **8 аккаунтов**, роли, хеши паролей и user/passkey данные сохранены.
- Отпечатки accounts, children, user_credentials, user_entities, landing_content,
  studio_settings, studio_sessions и bookings совпадают с исходными.
- Состав и SHA256 каждого из **2 исходных писем** точно совпадают с backup;
  лишнего диагностического письма нет. Удаление выполнено через закрытый API с
  проверкой точного ID/темы и запретом удаления исходного ID, не массовой очисткой.
- PostgreSQL, MailHog, mailhog-access, backend и frontend имеют прежние
  container ID/image/StartedAt/mounts. Из старых контейнеров изменился только proxy.
- Application env, shared vhost/TLS неизменны. Удаление добавленного fragment из
  shared snippet даёт ровно прежний SHA256, без посторонних правок.
- `/`, `/repair_demo/`, `/lastochka/` и public landing API отвечают 200;
  SHA256 ответов совпадают с исходными. `certbot.timer` активен.

Backup и серверные конфиги остаются доступны для отката. Локальные свидетельства:
`runtime-data/server-deploy/mailhog-public-1.0.0/` и
`artifacts/server-deploy/mailhog-public-1.0.0/` (не отслеживаются Git).
Проверочный server-ops.py находится только в локальном runtime-data и передавался
в SSH stdin; credentials/ключи не выводились и в пакет не помещались.
Предварительный отказ проверки был ошибкой сериализации tuples/lists снимка;
он произошёл до изменения маршрутов и исправлен в проверочном скрипте.

Ящик общий и публичный, включая прежние письма с recovery-ссылками; read-only
ограничивает MailHog, а не полномочия ссылок. Тестовый характер/ограничения большого
inbox — в [runbook](../mailhog-public-operations.md). Внешняя почтовая доставка не включена.
OpenSpec архивирован 23.10.2026; требования синхронизированы.

## Проверенный способ отключения

Установить `MAILHOG_PUBLIC_PREVIEW_ENABLED=false` только в
`/opt/lastochka/mailhog-public/shared/public.env`, затем:

```sh
docker compose -p lastochka-preview \
  --env-file /opt/lastochka/shared/.env.preview \
  --env-file /opt/lastochka/mailhog-public/shared/public.env \
  -f /opt/lastochka/releases/mailhog-websocket-20261023/compose.preview.yaml \
  -f /opt/lastochka/mailhog-public/current/compose.mailhog-public.yaml \
  up -d --no-deps --force-recreate mailhog-public
```

Эта операция реально проверена: закрывает старые WSS, даёт 404 новому посетителю,
сохраняет SMTP/operator/письма/данные. Итоговая приёмка вернула flag=true и проверила
возобновление работы. Один reload shared Nginx для прекращения старых WSS недостаточен.
Не перезапускать приложения, не делать down -v, сброс аккаунтов или восстановление БД.
Отключение публичного ящика не отзывает уже скопированные ссылки.
