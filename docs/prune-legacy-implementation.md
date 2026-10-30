# Удаление прежней модели — результат

24.10.2026 выполнен `prune-legacy-code-mailhog-and-schema`, поставлены backend/frontend
**0.9.0**, PostgreSQL **V12**. Серверный отчёт: [поставка](deployment/2026-10-24-prune-legacy.md).
Действующие три ADMIN, пароли/ключи, сессии, расписание/контент, заявки, Telegram,
платёжные черновики, аудит и повторы команд сохранены. Исходные V1–V11 не менялись.

## Журнал решений

| Область | Решение и доказательство |
| --- | --- |
| customers/bookings | Удалены целиком из исходников/settings/app dependencies, включая entities/repo/controllers/attendance/preview/workers; чистый check/bootJar не требуют этих модулей |
| notifications | Удалены email outbox, cipher/retention/SMTP worker/adapter/config и mail starter; сохранены только Telegram DTO/config/repo/sender/queue/worker |
| identity | Удалены RegistrationService/EmailTokenService/AuthTokenRepository/registration lock, родительский directory/query/DTO, прежний preview accounts seed и email DTO. AuthService больше не зависит от них |
| Ключи | Отзыв остальных сессий из почтовой службы перенесён в SessionRevocationRepository. Сохранены principal/accounts.email, user handles, credentials, Argon2/bcprov, origin/RP и auth_version/generation |
| scheduling | Удалены SessionReservations/ObjectProvider, occupancy/freePlaces и мёртвый previewMove/started; полный календарь и актуальные действия сохранены |
| app/common | Удалены confirmation filter/почтовые свойства, attendance security exemptions/схемы и старые описания OpenAPI; гостевая заявка правильно документирована публичной. Metadata сокращена по потребителям; общие каталоги динамических русских ошибок/проверок сохранены |
| frontend | Удалены неиспользуемая password-policy реализация, старые uiText email/checkLink/verifyFirst, неиспользуемый onAction входа, старые registration/mail helpers тестов. Остальные компоненты имеют потребителей, стили лендинга/календаря/форм сохранены; нейтральные legacy routes остаются действующей совместимостью |
| Схема | V12 удаляет children/bookings/auth_tokens/notification_outbox/attendance_grants/attendance_contexts/move_previews, без CASCADE. Непустые таблицы и чужой FK останавливают транзакцию |
| Инфраструктура | Удалены MailHog/vendor UI/public/operator overlays/почтовые Compose/env/SMTP/mail-сеть/volumes и старые исполняемые стенды/упаковщики. Прокси сохраняет404 |
| Тесты/CI | Удалены старые семейные suites .txt и общая неиспользуемая password matrix; миграционные данные находятся в актуальных Kotlin-тестах. CI использует выделенный PostgreSQL и закрытый fixture ADMIN, актуальную браузерную матрицу без MailHog |
| История | OpenSpec-архивы, датированные отчёты, Flyway V1–V11 и приватные backup сохранены; старые инструкции не являются текущим способом запуска |

Полный исходный набор до изменений и список удалённых путей: `artifacts/prune-legacy/source-before.tar.gz`,
`source-before.json`, `deleted-paths.json`. Сборки, зависимости и секреты туда не включались.
Финальный обход не нашёл production SQL к удалённым таблицам; старые строковые адреса
сохраняются только для410. Не удалены таблицы ключей/сессий/аудита/replay или внутренний
email-principal ради названия/пустоты. PostgreSQL не пересоздавался, VACUUM FULL не запускался.

## Проверки

- Чистый Java25 `clean check :app:bootJar`: **23 теста**, 0 ошибок; обязательный
  architectureCheck прошёл. Четыре новых теста: populated V11→V12 (ключ/сессия/
  занятие/аудит/повтор/заявка/очередь/DRAFT), отказ при непустой старой таблице,
  отказ при внешнем FK без CASCADE и fresh install всей цепочки.
- Основная браузерная матрица: **28 passed, 4 штатных skip WebKit virtual-key**.
  Chromium проверяет виртуальную привязку/проверку ключей; физическое устройство
  и биометрия не принимались.
- Лендинг, изображения, drag/клавиатура, scroll/reduced-motion/touch и production
  performance: **12 passed**. Начальный параллельный прогон попал в перезапуск
  локального backend; после стабилизации стенда полный набор прошёл.
- Готовые Linux/amd64 образы через HTTPS: **8 passed**, Chromium/WebKit ×375/1440,
  JavaScript/без JS, scoped Secure/HttpOnly cookie, ADMIN/заявка/DRAFT/404.
- Языковые self-tests: **4 passed**, включая отрицательные проверки блокирования
  сборки/упаковщиков до Docker; check:ui-language/typecheck/build прошли. CI-пути
  проверены локальными эквивалентами, удалённый CI не запускался.
- OpenAPI экспортирован из работающего backend, TypeScript сгенерирован штатно;
  действующий frontend собирается с ним, ручных transport DTO нет.
- Restore на отдельной БД с новой generation отклонил старую cookie и сохранил
  новые заявки/очередь/DRAFT при смене текущего и совместимого V12-кандидата.
  Это локальная репетиция, не живой откат сервера. 0.8.0 отклонён schema gate.
- Runtime JAR/SSR в проверенных контейнерах и на сервере совпали с финальными
  локальными сборками. Каждая принятая пара содержит concept marker и schema.min/max=12.

Логи: `artifacts/prune-legacy/backend-final.log`, `tests-populated.log`, `browser.log`,
`landing-final.log`, `https.log`, `language-tests.log`, `restore.log` и runtime hashes.
Старые зависимости, тестовые инструменты и baseline снимки не выдаются за актуальные проверки.

## Измерения

| Метрика | До 0.8.0 | После 0.9.0 |
| --- | ---: | ---: |
| JAR, байт | 82111016 | 80963578 |
| Backend image, Docker inspect Size | 264245273 | 187658880 |
| Frontend image, Docker inspect Size | 66744943 | 62866502 |
| Client build, байт | 1350940 | 898942 |
| SSR index.js, байт | 110292 | 109950 |
| Gradle-модули | 10 | 8 |
| Работающие серверные контейнеры | 6 | 4 |
| Backend RAM, снимок Docker stats | 442.9MiB | 382.8MiB |

Это снимки одной среды, не гарантия будущего RSS. Frontend сразу после браузерного
прогона использовал больше памяти, чем до него; заявления об общем ускорении или
обязательном уменьшении каждого показателя не делаются. Размеры image — поле Size
Docker inspect, не сумма выводимых docker image ls значений. Для устранения старых
payload-слоёв scripts/prepare-clean-runtime.py повторно использует принятые Java/Node
runtimes без старых JAR/build; версии зависимостей и lockfile не менялись. Новых
зависимостей не добавлено.

Настройка настоящего Telegram и платёжного провайдера остаётся вне этого изменения.

Итог: **26/26 задач**, OpenSpec **14 passed, 0 failed**, состояние apply all_done.
Живой серверный OpenAPI совпал с контрактом генерации; у гостевой заявки требуется
только CSRF, прежних attendance-схем безопасности нет. Health/readiness/liveness200/UP,
перезапусков приложений0; nginx -t и certbot.timer исправны.
