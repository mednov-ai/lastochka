import type { components } from '../api/schema';

type Row = components['schemas']['SeriesPlanRow'];

const reasons: Record<string, string> = {
  FIELD_SESSION_START: 'Начало занятия уже наступило. Измените дату или время в параметрах.',
  SERIES_BEFORE_CURRENT_WEEK:
    'Дата занятия раньше текущей недели по Москве. Измените начальную дату и проверьте расписание снова.',
  SCHEDULE_CONFLICT: 'Это время уже занято другим занятием.',
  SERIES_ITEM_DRAFT: 'У занятия есть отдельный черновик. Сначала сохраните или отбросьте его.',
};

export function conflictMessages(row: Row): string[] {
  if (!row.conflictCodes?.length) return row.conflict ? [row.conflict] : [];
  const known = row.conflictCodes.map((code) => reasons[code]);
  const messages = known.filter((value): value is string => !!value);
  if (known.some((value) => !value)) messages.push(row.conflict || 'Проверьте параметры занятия.');
  return [...new Set(messages)];
}

export function hasConflict(row: Row): boolean {
  return !!row.conflict || !!row.conflictCodes?.length;
}

export function ConflictMessages({ row }: { row: Row }) {
  return conflictMessages(row).map((message) => (
    <p className="error" key={message}>
      {message}
    </p>
  ));
}
