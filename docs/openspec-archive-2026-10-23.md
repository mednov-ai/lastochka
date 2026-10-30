# Закрытие OpenSpec — 23 октября 2026

По поручению пользователя архивированы все 9 завершённых изменений по схеме
spec-driven. Перед перемещением проверены графы артефактов, 299/299 задач,
доказательства приёмки и синхронизация всех 21 delta-spec. Незавершённых артефактов
или отмеченных невыполненными задач нет. Сервисы, исходники приложения и данные
при архивировании не менялись.

## Состав архива

| Изменение | Задачи | Результаты |
| --- | --- | --- |
| [create-lastochka-booking-mvp](../openspec/changes/archive/2026-10-23-create-lastochka-booking-mvp/) | 73/73 | [Доказательства](verification.md) |
| [deploy-lastochka-test-preview](../openspec/changes/archive/2026-10-23-deploy-lastochka-test-preview/) | 20/20 | [Доказательства](deployment/2026-10-19-public-access.md) |
| [refine-landing-motion-and-booking](../openspec/changes/archive/2026-10-23-refine-landing-motion-and-booking/) | 19/19 | [Доказательства](deployment/2026-10-20-landing-refinement.md) |
| [fix-format-card-image-composition](../openspec/changes/archive/2026-10-23-fix-format-card-image-composition/) | 11/11 | [Доказательства](deployment/2026-10-23-format-composition.md) |
| [improve-calendar-and-client-confirmation](../openspec/changes/archive/2026-10-23-improve-calendar-and-client-confirmation/) | 52/52 | [Доказательства](deployment/2026-10-23-calendar-confirmation.md) |
| [expose-mailhog-test-preview](../openspec/changes/archive/2026-10-23-expose-mailhog-test-preview/) | 23/23 | [Доказательства](deployment/2026-10-23-mailhog-public-preview.md) |
| [improve-auth-verification-and-error-feedback](../openspec/changes/archive/2026-10-23-improve-auth-verification-and-error-feedback/) | 35/35 | [Доказательства](deployment/2026-10-23-auth-feedback.md) |
| [localize-user-hints-in-russian](../openspec/changes/archive/2026-10-23-localize-user-hints-in-russian/) | 26/26 | [Доказательства](deployment/2026-10-23-russian-feedback.md) |
| [refactor-backend-repository-and-common](../openspec/changes/archive/2026-10-23-refactor-backend-repository-and-common/) | 40/40 | [Доказательства](deployment/2026-10-23-backend-refactoring.md) |

Каждый каталог находится в `openspec/changes/archive/2026-10-23-<name>/`.
Сохранены все 57 исходных файлов, включая 9 `.openspec.yaml`, с прежними SHA256.
Имена получили один префикс даты; исходные каталоги активных изменений отсутствуют.

## Синхронизация

Созданы 13 основных спецификаций, 113 требований и 211 сценариев. Все выбранные
пути получены из `openspec status --json`; перед записью для каждого изменения
получен и применён снимок инструкций specs. Дополнительных rules/operationGuidance
не было. Общий контекст требует русский язык и сохранность контрактов/данных;
конфликтов с выбранным корнем проекта или поручением нет.

Первичный перенос сохранил все 113 требований и 210 сценариев. Затем 13 ранних
требований согласованы с явно принятыми поздними решениями; добавлен сценарий
совместимого отката backend. Исходные delta-specs в архиве не переписывались.

| Область | Разрешённое расхождение с ранним планом | Основание |
| --- | --- | --- |
| Вход и ключи | Полный вход по паролю, добровольный WebAuthn для всех ролей, управление своими ключами после недавнего парольного входа | deploy-lastochka-test-preview, серверная приёмка 0.3.0 и последующие |
| Новый пароль и VERIFY | 6–128/L/Nd, сохранение старых паролей, нейтральный повтор успешного VERIFY до исходного TTL | improve-auth-verification-and-error-feedback, приёмка 0.6.0 |
| Путь записи | Гостю регистрация, после входа возврат к расписанию; явный просмотр расписания публичен | refine-landing-motion-and-booking |
| Иллюстрации форматов | Отклик карточки сохраняется, обязательного zoom изображения нет | fix-format-card-image-composition |
| Почтовый доступ | Операторские UI/API и SMTP закрыты; отдельный общий просмотр явно включается только в тестовой среде | expose-mailhog-test-preview |
| Почтовые статусы | Публичный интерфейс показывает «Подключено», private operator может использовать native UI | localize-user-hints-in-russian |
| Откат | Generation отзывается при несовместимом возврате/restore; совместимый 0.7.0→0.6.1 сохраняет ключи/generation и данные | отчёты календаря и backend 0.7.0, действующий runbook |

Нормативные тексты из всех 21 delta-spec повторно сопоставлены с итогом:
неизменённые блоки совпадают, перечисленные уточнения подтверждены соответствующим
поздним решением. В main specs нет ADDED/MODIFIED-заголовков, дублирующихся
требований, пустых разделов или TBD Purpose. Не затронутые сценарии сохранены.

## Проверки и статус

- До перемещения: `openspec validate --all --strict` — 22/22 (9 изменений и 13 specs).
- Основные specs после согласования: `openspec validate --specs --strict` — 13/13.
- Все 57 файлов изменений сохранены по SHA256 после перемещения.
- После архивирования: `openspec list --json` возвращает пустой changes;
  итоговая строгая проверка спецификаций проходит.
- Обновлены README, AGENTS, карта документации, ссылки на архив и
  [текущий статус проекта](project-status.md).

OpenSpec выводит информационные рекомендации о длине некоторых требований;
ошибок проверки нет. Резервный локальный снимок до операции и машинные результаты:
`runtime-data/openspec-archive-20261023/` (вне Git).

Закрытие изменений не является новой поставкой или повторным прогоном прикладных
тестов. Актуальны backend 0.7.0/frontend 0.6.1/mail UI 1.0.1/V9 и доказательства
[последней поставки](deployment/2026-10-23-backend-refactoring.md). Физические ключи,
реальная доставка и production остаются за пределами завершённой приёмки.
