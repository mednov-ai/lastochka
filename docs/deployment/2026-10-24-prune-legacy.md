# Очистка прежней модели — поставка 0.9.0

24.10.2026 по прямому поручению apply и «выкатывай на сервер» поставлены
**backend/frontend0.9.0, PostgreSQL V12** на https://play-and-say.ru/lastochka/.
Работают только proxy/frontend/backend/PostgreSQL. Семь старых таблиц удалены;
все три ADMIN (admin1/admin2/doctor1), их пароли/ключи и действующие данные сохранены.

## Копия и обновление

Backup: `/opt/lastochka/backups/pre-0.9.0-20261024T010847Z/`, каталог700,
dump/mail archive/config/env600. В короткое обслуживание только Lastochka
остановлены старые приложения/worker. Dump восстановлен в отдельную временную БД,
сверены действующие агрегаты, на копии выполнена точная V12, отпечатки совпали.
Затем настоящий Flyway применил V12; исходные V1–V11 не переписывались.
Схема не мигрировалась обходом проверок: все семь таблиц до удаления были пусты.

Пакет локально собранных Linux/amd64 образов — `/opt/lastochka/releases/0.9.0/`.
Весь manifest проверен перед docker load; обе метки concept/schema12 проверены.
Образы на сервере не собирались. Рабочая Compose — compose.preview.yaml в этом
каталоге, env — `/opt/lastochka/shared/.env.preview`, проект lastochka-preview.
Изменены теги образов, удалены retired EMAIL/SMTP/MAILHOG/ATTENDANCE переменные;
пароли/ключи, origin/RP и access generation сохранены. PostgreSQL не перезапускался.
Shared Nginx изменил только собственный snippet обслуживания Lastochka; после
проверки возвращён действующий snippet. TLS/ACME и соседние / и /repair_demo/ сохранены.

Runtime JAR SHA256:
`dde9d611912ab9a6fe8c119fb14bf8c393a0805263fe161b71ecc07c0959fe99`.
Runtime SSR SHA256:
`48db10e0089adf6cca46e63eebd5226e4d6fd45dfc1b4e698606821cf369ffc6`.
Они совпадают с принятыми локальными сборками; image IDs/размеры — в manifest/images.jsonl
пакета и metrics.json локального отчёта. Это image IDs, не registry digest.

## Приёмка и удаление MailHog

`scripts/remote-pruned-acceptance.mjs`: **59 проверок**, восемь контекстов
Chromium/WebKit × en-US/ru-RU ×375/1440. Проверены административный вход,
публикация/календарь, гостевая форма и русские ошибки, отправка без JavaScript,
повтор заявки без дубля, просмотр/состояние очереди, точные копейки DRAFT,
запрет выпуска ссылки, scoped Secure/HttpOnly cookie, CSRF/origin/права,
старые410/почтовые404, мобильная читаемость и отсутствие page errors.

Только после проверки копии трёх писем и успешной приёмки адресно удалены:
- lastochka-preview-mailhog-public-1, mailhog-access-1, mailhog-1;
- том lastochka-preview_mailhog-data;
- сеть lastochka-preview_mail;
- два почтовых образа без потребителей. Общий Nginx image сохранён.

Проверены Compose-владелец, отсутствие чужих потребителей и имена ресурсов.
Общий prune/down -v/force removal не использовались. Письма находятся только в
приватной проверенной maildir.tar.gz, работающего почтового UI/SMTP/operator больше нет.
Пользовательские SSH-туннели не закрывались; инструкция MailHog18027 выведена из эксплуатации.
Старые release-конфиги/backup сохранены исторически, новая среда их не использует.

Собственные временный ADMIN/занятие/заявки/очередь/черновик/аудит/повторы удалены
адресно. Первый cleanup-скрипт ещё обращался к удалённой auth_tokens; транзакция
полностью откатилась, затем скрипт адаптирован к V12 и очистка прошла. Это ошибка
инструмента приёмки; приложение ради неё не менялось и повторно не выкатывалось.
Итоговые бизнес-отпечатки совпали с исходными. Финальный dump600:
`/opt/lastochka/backups/lastochka/ready-for-testing-0.9.0-20261024.dump`.
После очистки: ADMIN3, заявок0, черновиков0, старых таблиц0, схема12.

Доказательства: `artifacts/prune-legacy/` и `runtime-data/prune-legacy/`, вне Git.
Локальные результаты/измерения: [отчёт](../prune-legacy-implementation.md).
Физический ключ, настоящий Telegram-чат, платёжный провайдер и production не принимались.

## Откат

0.8.0 после V12 несовместим: совпадение ADMIN_ENQUIRIES_V1 недостаточно, schema gate
его отклоняет. Обычный откат возможен только к подтверждённой V12-паре с сохранением
новых заявок/очереди/DRAFT. Старый dump поверх новых данных не применять.
Disaster restore требует изоляции, проверки marker/схемы и новой внешней generation.
Подробности — [runbook](../prune-legacy-operations.md). Сам change остаётся активным
до отдельного архивирования; delta specs отражают новую поставленную модель.
