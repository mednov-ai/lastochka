import { useEffect, useId, useRef } from 'react';
import type { components } from '../api/schema';
import { dayLabel, dayStart } from './calendar-time';
import { ConflictMessages, hasConflict } from './series-conflicts';
import { moscow } from './workspace';

type Row = components['schemas']['SeriesPlanRow'];
const actions: Record<string, string> = {
  CREATE: 'Добавится',
  CHANGE: 'Изменится',
  CANCEL: 'Отменится',
  KEEP: 'Сохранится',
};

export function SeriesPlanTable({ rows, focusError = 0 }: { rows: Row[]; focusError?: number }) {
  const id = useId();
  const table = useRef<HTMLTableElement>(null);
  useEffect(() => {
    if (!focusError) return;
    const target = table.current?.querySelector<HTMLElement>('tr[data-conflict="true"]');
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focusError]);
  return (
    <table ref={table} className="plan-table" role="table" aria-label="Даты и ошибки плана">
      <colgroup>
        <col className="plan-date" />
        <col className="plan-action" />
        <col />
      </colgroup>
      <thead role="rowgroup">
        <tr role="row">
          <th role="columnheader" id={`${id}-date`} scope="col">
            Дата и время
          </th>
          <th role="columnheader" id={`${id}-action`} scope="col">
            Действие
          </th>
          <th role="columnheader" id={`${id}-status`} scope="col">
            Проверка
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {rows.map((row) => {
          const conflict = hasConflict(row);
          const session = row.proposed ?? row.before;
          return (
            <tr
              role="row"
              key={row.originalDate}
              data-conflict={conflict}
              tabIndex={conflict ? -1 : undefined}
            >
              <th
                role="rowheader"
                scope="row"
                id={`${id}-${row.originalDate}`}
                headers={`${id}-date`}
                data-label="Дата и время"
              >
                <strong>{dayLabel.format(dayStart(row.originalDate))}</strong>
                {session ? <span className="plan-time">{moscow(session.startsAt)}</span> : null}
              </th>
              <td
                role="cell"
                headers={`${id}-${row.originalDate} ${id}-action`}
                data-label="Действие"
              >
                {actions[row.action] ?? row.action}
                {row.exception ? <span className="plan-time">Разовое изменение</span> : null}
              </td>
              <td
                role="cell"
                headers={`${id}-${row.originalDate} ${id}-status`}
                data-label="Проверка"
              >
                <div
                  className={'plan-status ' + (conflict ? 'plan-status-error' : 'plan-status-ok')}
                >
                  <svg
                    viewBox="0 0 20 20"
                    width="20"
                    height="20"
                    aria-hidden="true"
                    focusable="false"
                  >
                    {conflict ? <path d="M5 5l10 10M15 5 5 15" /> : <path d="m4 10 4 4 8-9" />}
                  </svg>
                  <div>{conflict ? <ConflictMessages row={row} /> : <span>Нет ошибок</span>}</div>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
