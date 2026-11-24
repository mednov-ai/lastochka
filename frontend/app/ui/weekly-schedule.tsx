import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router';
import { api } from '../api/client';
import { revealOnce } from './landing-motion';
import {
  weekdays,
  weeklyChoice,
  weeklyTime,
  type WeeklyInterval,
  type WeeklySchedule,
} from './weekly-interval';

function TimeLink({ interval, age, row }: { interval: WeeklyInterval; age: string; row: number }) {
  const time = weeklyTime(interval);
  const search = new URLSearchParams({
    weekly: weeklyChoice(interval.reference),
    direction: interval.directionId,
  });
  return (
    <Link
      className="poster-time"
      style={{ '--wave': interval.weekday + row * 0.6 } as CSSProperties}
      to={'/enquiry?' + search}
      aria-label={`${age}, ${weekdays[interval.weekday - 1]}, ${time}`}
    >
      {time}
    </Link>
  );
}

export function WeeklyPoster({ initial }: { initial: WeeklySchedule | null }) {
  const [schedule, setSchedule] = useState(initial);
  const [retrying, setRetrying] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => setSchedule(initial), [initial]);
  useEffect(() => {
    const el = panel.current;
    if (!el || !schedule?.intervals.length) return;
    return revealOnce([el]);
  }, [schedule]);
  async function retry() {
    setRetrying(true);
    try {
      const result = await api.GET('/api/v1/public/schedule/weekly');
      setSchedule(result.data ?? null);
    } finally {
      setRetrying(false);
    }
  }
  if (!schedule)
    return (
      <div className="notice error" role="alert">
        Не удалось загрузить расписание.{' '}
        <button className="button light" type="button" disabled={retrying} onClick={retry}>
          {retrying ? 'Загрузка…' : 'Повторить загрузку'}
        </button>{' '}
        <Link to="/enquiry">Оставить заявку</Link>
      </div>
    );
  const { directions, intervals } = schedule;
  if (!intervals.length)
    return (
      <div className="poster-day poster-day-empty">
        <h3>Набираем группы</h3>
        <p>Постоянное время пока не опубликовано. Поможем подобрать группу и день.</p>
        <Link className="button" to="/enquiry">
          Оставить заявку
        </Link>
      </div>
    );
  const days = weekdays.slice(0, intervals.some((i) => i.weekday === 7) ? 7 : 6);
  const rows = directions.map((direction) => ({
    direction,
    slots: intervals.filter((i) => i.directionId === direction.id),
  }));
  return (
    <div ref={panel} className="poster-panel">
      <div
        className="poster-card poster-wide"
        role="region"
        aria-label="Таблица расписания"
        tabIndex={0}
      >
        <table className="poster-table">
          <caption className="visually-hidden">
            Постоянные занятия по дням недели и возрасту
          </caption>
          <thead>
            <tr>
              <th scope="col">Возраст</th>
              {days.map((day) => (
                <th key={day} scope="col">
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ direction, slots }, row) => (
              <tr key={direction.id}>
                <th scope="row">{direction.title}</th>
                {slots.length ? (
                  days.map((day, index) => {
                    const items = slots.filter((i) => i.weekday === index + 1);
                    return (
                      <td key={day}>
                        {items.length ? (
                          <ul>
                            {items.map((i) => (
                              <li className="poster-slot" key={i.reference.seriesId}>
                                <TimeLink interval={i} age={direction.title} row={row} />
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="poster-dot" aria-hidden="true" />
                        )}
                      </td>
                    );
                  })
                ) : (
                  <td colSpan={days.length}>
                    <Link to={'/enquiry?direction=' + direction.id}>Подобрать время</Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="poster-days poster-narrow">
        {days.map((day, index) => {
          const items = rows.flatMap(({ direction, slots }) =>
            slots
              .filter((i) => i.weekday === index + 1)
              .map((interval) => ({ direction, interval })),
          );
          return items.length ? (
            <section className="poster-day" key={day}>
              <h3>{day}</h3>
              <ul>
                {items.map(({ direction, interval }) => (
                  <li key={interval.reference.seriesId} className="poster-day-row">
                    <span className="poster-age">{direction.title}</span>
                    <TimeLink interval={interval} age={direction.title} row={0} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null;
        })}
        {rows
          .filter((row) => !row.slots.length)
          .map(({ direction }) => (
            <p key={direction.id}>
              {direction.title} ·{' '}
              <Link to={'/enquiry?direction=' + direction.id}>Подобрать время</Link>
            </p>
          ))}
      </div>
      <p className="poster-footer">
        Дату первого занятия согласует администратор.{' '}
        <Link to="/enquiry">Оставить общую заявку</Link>
      </p>
    </div>
  );
}
