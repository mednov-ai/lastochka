# Ласточка

Сайт студии детской оздоровительной гимнастики: публичное расписание и гостевая
заявка, закрытый кабинет заранее заданных администраторов. Регистрации, семейных
кабинетов, самостоятельного бронирования и электронной почты нет. Визуальная
основа — «01 Воздух». Требования: [AGENTS.md](AGENTS.md), [OpenSpec](openspec/specs/).

## Состояние

[Публичная тестовая среда](https://play-and-say.ru/lastochka/): **backend/frontend
0.9.0**, PostgreSQL **V12**. Административные логины: **admin1, admin2, doctor1**,
пароли и ключи сохранены. По прямому поручению удалены шесть обычных аккаунтов и
одна карточка ребёнка; старых записей на занятия не было. Публичная почта закрыта,
три прежних письма сохранены только в проверенной приватной резервной копии; почтовые службы удалены.

Заявка без аккаунта сохраняется вместе с очередью Telegram, без резервирования
места. Бот пока не настроен. Администратор редактирует/публикует расписание,
читает обращения и готовит черновики оплаты. Провайдер не выбран, выпуск
настоящих ссылок и статус оплаты недоступны.

[Поставка и резервная копия](docs/deployment/2026-10-24-prune-legacy.md),
[текущее состояние](docs/project-status.md), [эксплуатация](docs/prune-legacy-operations.md).
Все 10 изменений архивированы, 339/339 задач. Активен реализованный и поставленный prune-legacy-code-mailhog-and-schema;
основных спецификаций13, требований83, сценариев170.

## Стек и структура

- Java25, Kotlin2.3.21, Spring Boot4.1.1, Spring Security7.1.1, Gradle9.5.1.
- React19.3.1, TypeScript5.9.3, React Router8.4.0, Vite8.3.4, Node.js24 LTS.
- PostgreSQL17 и Flyway. Почтовое хранилище — только закрытый архив, приложение
  от SMTP не зависит.
- `backend/`: app, identity, scheduling, enquiries, notifications, payments, content, common.
  Старые bookings/customers и почтовые зависимости удалены. Запускаемый JAR
  создаёт только app; frontend в него не входит.
- `frontend/`: лендинг, гостевая форма и ADMIN, отдельный Node SSR runtime.
- `api/openapi.json` — экспорт backend, `frontend/app/api/schema.d.ts` генерируется.
- `infra/` — конфигурации; `info/`, секреты, зависимости и результаты сборки не в Git.

## Локальная работа

Нужны Java25, Node24 и Docker Compose. Перед запуском на существующей БД изучите
[границу удаления V10/V11](docs/prune-legacy-operations.md): новый JAR применяет
миграции при старте. Для разработки используйте только собственную локальную БД.

```sh
docker compose -f compose.local.yaml up -d
cd backend
./gradlew check :app:bootJar
java -jar app/build/libs/app-0.1.0.jar
```

PostgreSQL по умолчанию `127.0.0.1:55432`, отдельная БД/пользователь lastochka.
Пароль local-lastochka предназначен только для локальной среды. Local Compose запускает только PostgreSQL, почтовых служб нет.

В другом терминале из frontend:

```sh
npm ci --include=dev
npm run dev
```

Открыть http://localhost:5173/lastochka/. API проксируется в backend в том же origin.
Health: http://127.0.0.1:8080/lastochka/actuator/health. Остановите процесс до
замены исполняемого JAR. Production frontend также нужно остановить до замены build/.

## Вход и интеграции

ADMIN создаются только оператором. Перед одноразовым запуском безопасно задайте
LASTOCHKA_ADMIN_LOGIN, LASTOCHKA_ADMIN_NAME и LASTOCHKA_ADMIN_PASSWORD в приватном
окружении. Не передавайте пароль в аргументах и не сохраняйте в Git.

```sh
java -jar backend/app/build/libs/app-0.1.0.jar --lastochka.admin.create=true --server.port=0 --lastochka.workers.enabled=false
```

Назначение логина существующему ADMIN по ID и операторский сброс описаны в
[runbook](docs/prune-legacy-operations.md). Новый пароль — 6–128 Unicode code
points, буква L и цифра Nd; прежние хеши проверяются без изменения состава пароля.
Добровольные ключи доступны в «Безопасности»; их отсутствие не мешает паролю.
Действуют CSRF, scoped HttpOnly cookie, проверка допуска и внешней generation.

TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID задаются только в приватной серверной env.
Без них заявка сохраняется, очередь ждёт настройки. Имитатор не подтверждает
настоящую доставку. Настройка и приёмка выбранного чата выполняются отдельно.
Платёжные операции, webhook и возвраты также требуют отдельного подключения.

## Контракт и проверки

При работающем backend из корня:

```sh
python3 scripts/export-openapi.py
npm --prefix frontend run api:generate
npm --prefix frontend run check:ui-language
npm --prefix frontend run typecheck
npm --prefix frontend run build
openspec validate --all --strict
```

Транспортные DTO вручную не писать. Backend architectureCheck входит в check,
bootJar и упаковку. Все собственные тексты — русские; языковая проверка блокирует
сборку/CI/упаковку. Backend integration tests создают отдельную Testcontainers БД.
Браузерная матрица `playwright.concept.config.ts` требует специально подготовленных
изолированных fixtures и TEST_DATABASE_CONTAINER=lastochka-concept-postgres;
произвольная или серверная БД не допускается. Прежние семейные тесты удалены; миграционные fixtures находятся в актуальных Kotlin-тестах. Подробные результаты и ограничение
виртуальных ключей — в [локальном отчёте](docs/prune-legacy-implementation.md).

## Поставка

Готовые независимо версионируемые Linux/amd64 образы собираются локально через
`scripts/build-release.sh VERSION`, артефакты/SHA256 — в artifacts/release-VERSION/.
Сервер запускает готовые образы. Проверяйте обе метки концепции перед публикацией
и откатом: `python3 scripts/check-concept-release.py BACKEND_IMAGE FRONTEND_IMAGE`.

Используйте `.env.preview.example` как шаблон приватной env, задайте настоящие
URL/origin/RP, новые секрет БД/generation и принятые теги. Перед серверным изменением
нужны backup и проверенный restore. MailHog и его инфраструктура удалены; старый почтовый путь возвращает404.

**0.8.0 и более старые версии не являются штатным откатом после V12**. Не восстанавливать старый dump
поверх новых заявок/очереди/черновиков. Disaster restore требует новой внешней
ADMIN_ACCESS_GENERATION. Не изменять соседние корневые маршруты, TLS/ACME и чужие
контейнеры. Инструкции — [admin-concept-operations.md](docs/prune-legacy-operations.md).
