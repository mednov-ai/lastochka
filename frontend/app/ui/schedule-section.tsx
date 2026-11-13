import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { api, message } from '../api/client';
import { addDays, dateKey, dayStart, monday, timeLabel } from './calendar-time';
import { enquiryLink, type ScheduleEntry } from './schedule-occurrence';
import { loadScheduleProjection } from './schedule-projection';
import { posterRows, type PosterDirection, type PosterRow } from './schedule-poster-rows';
import { uiText } from './ui-texts';
import './schedule-table.css';

const zone = 'Europe/Moscow';
const weekdayName = new Intl.DateTimeFormat('ru-RU', { timeZone: zone, weekday: 'long' });
const dayNumber = new Intl.DateTimeFormat('ru-RU', {
  timeZone: zone,
  day: 'numeric',
  month: 'long',
});
const onlyDay = new Intl.DateTimeFormat('ru-RU', { timeZone: zone, day: 'numeric' });
const monthKey = new Intl.DateTimeFormat('en-CA', { timeZone: zone, month: '2-digit' });
const capital = (text: string) => text.charAt(0).toLocaleUpperCase('ru-RU') + text.slice(1);
const currentWeek = () => monday(dateKey(new Date()));

function weekRange(date: string) {
  const first = dayStart(date);
  const last = dayStart(addDays(date, 6));
  const sameMonth = monthKey.format(first) === monthKey.format(last);
  return `${sameMonth ? onlyDay.format(first) : dayNumber.format(first)} — ${dayNumber.format(last)}`;
}

function Slot({ entry, row, day }: { entry: ScheduleEntry; row: string; day: string }) {
  const { summary } = entry;
  const time = `${timeLabel.format(new Date(summary.startsAt))}–${timeLabel.format(new Date(summary.endsAt))}`;
  const note =
    summary.format === 'INDIVIDUAL'
      ? summary.title
      : summary.title.trim() !== row
        ? summary.title
        : '';
  const open = entry.status === 'OPEN' && new Date(entry.startsAt).valueOf() > Date.now();
  const cancelled = entry.status === 'CANCELLED';
  return (
    <li className="poster-slot">
      {open ? (
        <Link
          className="poster-time"
          to={enquiryLink(entry)}
          aria-label={`Оставить заявку: ${row}${note ? `, ${note}` : ''}, ${day}, ${time}`}
        >
          {time}
        </Link>
      ) : (
        <span className="poster-time poster-time-closed">
          {time}
          <span className="visually-hidden">
            , {cancelled ? 'отменено' : 'заявки не принимаются'}
          </span>
        </span>
      )}
      {note ? <span className="poster-note">{note}</span> : null}
      {cancelled ? (
        <span className="poster-note" aria-hidden="true">
          Отменено
        </span>
      ) : null}
    </li>
  );
}

function Recruiting() {
  return (
    <span className="poster-recruiting">
      {uiText.scheduleRecruiting}
      <Link to="/enquiry">Оставить заявку</Link>
    </span>
  );
}

/** Next week loaded: null while loading, 'error' when it failed. */
type Ahead = ScheduleEntry[] | null | 'error';
const nearestLabel = new Intl.DateTimeFormat('ru-RU', {
  timeZone: zone,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/**
 * A row without sessions this week is not necessarily an empty group: the public schedule hides
 * sessions that already started, and a group may simply meet next week. Say what is known.
 */
function EmptyRow({
  next,
  ahead,
  onNextWeek,
}: {
  next?: ScheduleEntry;
  ahead: Ahead;
  onNextWeek: () => void;
}) {
  if (next)
    return (
      <span className="poster-nearest">
        {uiText.scheduleNearest}: {nearestLabel.format(new Date(next.startsAt))},{' '}
        {timeLabel.format(new Date(next.startsAt))}
        <button type="button" className="text-link" onClick={onNextWeek}>
          {uiText.scheduleShowNextWeek}
        </button>
      </span>
    );
  if (Array.isArray(ahead)) return <Recruiting />;
  return (
    <span className="poster-recruiting poster-neutral">
      {uiText.scheduleNoneThisWeek}
      <Link to="/enquiry">Оставить заявку</Link>
    </span>
  );
}

export function ScheduleSection() {
  const [date, setDate] = useState(currentWeek);
  const [value, setValue] = useState<ScheduleEntry[] | null>(null);
  const [directions, setDirections] = useState<PosterDirection[] | null>(null);
  const [directionError, setDirectionError] = useState(false);
  const [directionRetry, setDirectionRetry] = useState(0);
  const [error, setError] = useState('');
  const [ahead, setAhead] = useState<Ahead>(null);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const card = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  // Only a card that really scrolls sideways (narrow tablets) becomes a keyboard stop.
  useEffect(() => {
    const element = card.current;
    if (!element) return;
    const check = () => setScrollable(element.scrollWidth > element.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  });
  useEffect(() => {
    let active = true;
    void api
      .GET('/api/v1/public/age-directions')
      .then((response) => {
        if (response.error || !Array.isArray(response.data?.items))
          throw response.error ?? new Error();
        if (!active) return;
        // A direction without a numeric age cannot hold sessions; it is left out rather than shown empty.
        setDirections(
          response.data.items.filter((item) => item.active && Number.isInteger(item.ageFrom)),
        );
        setDirectionError(false);
      })
      .catch(() => {
        if (!active) return;
        setDirections([]);
        setDirectionError(true);
      });
    return () => {
      active = false;
    };
  }, [directionRetry]);
  useEffect(() => {
    const n = ++generation.current;
    setValue(null);
    setAhead(null);
    setError('');
    // The following week tells an empty row whether its group meets soon or is still forming.
    void loadScheduleProjection(
      dayStart(addDays(date, 7)).toISOString(),
      dayStart(addDays(date, 14)).toISOString(),
    )
      .then((items) => {
        if (n === generation.current) setAhead(items);
      })
      .catch(() => {
        if (n === generation.current) setAhead('error');
      });
    void loadScheduleProjection(
      dayStart(date).toISOString(),
      dayStart(addDays(date, 7)).toISOString(),
    )
      .then((items) => {
        if (n === generation.current) setValue(items);
      })
      .catch((err) => {
        if (n === generation.current)
          setError(
            err instanceof Error
              ? 'Не удалось загрузить расписание. Попробуйте ещё раз.'
              : message(err),
          );
      });
    return () => {
      generation.current++;
    };
  }, [date, retry]);

  const ready = value !== null && directions !== null;
  const rows: PosterRow[] = ready ? posterRows(value, directions) : [];
  const busy = new Set((value ?? []).map((entry) => dateKey(entry.startsAt)));
  // Monday to Saturday are working days; Sunday appears only when something is scheduled.
  const days = Array.from({ length: 7 }, (_, index) => addDays(date, index))
    .filter((day, index) => index < 6 || busy.has(day))
    .map((day) => ({
      day,
      weekday: capital(weekdayName.format(dayStart(day))),
      date: dayNumber.format(dayStart(day)),
    }));
  const aheadRows = ready && Array.isArray(ahead) ? posterRows(ahead, directions) : [];
  const nextFor = (row: PosterRow) =>
    aheadRows
      .find((item) => item.key === row.key)
      ?.days.values()
      .next().value?.[0];
  const showNextWeek = () => setDate(addDays(date, 7));
  const rowTitle = (row: PosterRow) => row.direction?.title ?? uiText.scheduleOther;
  // Without a direction the age of the session itself is the most useful label on a day card.
  const entryLabel = (row: PosterRow, entry: ScheduleEntry) => {
    const { ageFrom, ageTo, ageOpenEnded } = entry.summary;
    if (row.direction || ageFrom == null) return rowTitle(row);
    return ageOpenEnded ? `${ageFrom}+ лет` : `${ageFrom}–${ageTo} лет`;
  };
  const isCurrent = date === currentWeek();

  return (
    <section id="schedule" className="public-schedule" aria-labelledby="schedule-heading">
      <div className="poster-intro">
        <h2 id="schedule-heading">Расписание занятий</h2>
        <p className="poster-badge">{uiText.scheduleFilling}</p>
        <p className="poster-lead">
          Выберите время в таблице или оставьте заявку — поможем подобрать группу.{' '}
          {uiText.scheduleTimeZone}.
        </p>
      </div>
      <div className="schedule-enhanced">
        <div className="poster-week" role="group" aria-label="Выбор недели">
          <button
            type="button"
            className="poster-step"
            aria-label="Предыдущая неделя"
            onClick={() => setDate(addDays(date, -7))}
          >
            ←
          </button>
          <p className="poster-range" role="status">
            {weekRange(date)}
          </p>
          <button
            type="button"
            className="poster-step"
            aria-label="Следующая неделя"
            onClick={() => setDate(addDays(date, 7))}
          >
            →
          </button>
          <button
            type="button"
            className="poster-today"
            disabled={isCurrent}
            onClick={() => setDate(currentWeek())}
          >
            Текущая неделя
          </button>
          <label className="poster-date">
            <span>Дата</span>
            <input
              type="date"
              value={date}
              onChange={(event) => {
                if (event.target.value) setDate(monday(event.target.value));
              }}
            />
          </label>
        </div>
        {error ? (
          <div className="notice error" role="alert">
            <p>{error}</p>
            <button className="button light" type="button" onClick={() => setRetry((x) => x + 1)}>
              Повторить загрузку
            </button>
          </div>
        ) : null}
        {!ready && !error ? <p role="status">Загрузка расписания…</p> : null}
        {directionError ? (
          <p role="status" className="poster-direction-error">
            Не удалось загрузить возрастные направления. Занятия показаны по дням.{' '}
            <button
              className="text-link"
              type="button"
              onClick={() => setDirectionRetry((x) => x + 1)}
            >
              Повторить загрузку направлений
            </button>
          </p>
        ) : null}
        {ready && !error && directions.length > 0 ? (
          <div
            ref={card}
            className="poster-card poster-wide"
            role="region"
            aria-label="Таблица расписания"
            tabIndex={scrollable ? 0 : undefined}
          >
            <table className="poster-table">
              <caption className="visually-hidden">
                Занятия по дням недели и возрасту, {weekRange(date)}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Возраст</th>
                  {days.map((day) => (
                    <th scope="col" key={day.day}>
                      {day.weekday}
                      <span>{day.date}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{rowTitle(row)}</th>
                    {row.count === 0 ? (
                      <td colSpan={days.length} className="poster-empty-row">
                        <EmptyRow next={nextFor(row)} ahead={ahead} onNextWeek={showNextWeek} />
                      </td>
                    ) : (
                      days.map((day) => {
                        const slots = row.days.get(day.day) ?? [];
                        return (
                          <td key={day.day}>
                            {slots.length === 0 ? (
                              <span className="poster-dot" aria-hidden="true" />
                            ) : (
                              <ul>
                                {slots.map((entry) => (
                                  <Slot
                                    key={entry.key}
                                    entry={entry}
                                    row={rowTitle(row)}
                                    day={`${day.weekday.toLocaleLowerCase('ru-RU')}, ${day.date}`}
                                  />
                                ))}
                              </ul>
                            )}
                          </td>
                        );
                      })
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {ready && !error ? (
          <div className={directions.length > 0 ? 'poster-days poster-narrow' : 'poster-days'}>
            {days
              .filter((day) => busy.has(day.day))
              .map((day) => (
                <section
                  className="poster-day"
                  key={day.day}
                  aria-label={`${day.weekday}, ${day.date}`}
                >
                  <h3>
                    {day.weekday}
                    <span>{day.date}</span>
                  </h3>
                  <ul>
                    {rows.flatMap((row) =>
                      (row.days.get(day.day) ?? []).map((entry) => (
                        <li className="poster-day-row" key={entry.key}>
                          <span className="poster-age">{entryLabel(row, entry)}</span>
                          <ul>
                            <Slot
                              entry={entry}
                              row={entryLabel(row, entry)}
                              day={`${day.weekday.toLocaleLowerCase('ru-RU')}, ${day.date}`}
                            />
                          </ul>
                        </li>
                      )),
                    )}
                  </ul>
                </section>
              ))}
            {value.length === 0 ? (
              <section className="poster-day poster-day-empty">
                <h3>
                  {Array.isArray(ahead) && ahead.length === 0
                    ? 'Набираем группы'
                    : uiText.scheduleNoneThisWeek}
                </h3>
                {Array.isArray(ahead) && ahead.length > 0 ? (
                  <button type="button" className="button light" onClick={showNextWeek}>
                    {uiText.scheduleShowNextWeek}
                  </button>
                ) : null}
                {Array.isArray(ahead) && ahead.length === 0 && directions.length > 0 ? (
                  <ul className="poster-chips">
                    {directions.map((item) => (
                      <li key={item.id}>{item.title}</li>
                    ))}
                  </ul>
                ) : null}
                <p>Оставьте заявку — подберём группу и время.</p>
                <Link to="/enquiry" className="button">
                  Оставить заявку
                </Link>
              </section>
            ) : days.some((day) => !busy.has(day.day)) ? (
              <p className="poster-rest">
                В остальные дни этой недели занятий нет. <Link to="/enquiry">Оставить заявку</Link>
              </p>
            ) : null}
          </div>
        ) : null}
        {ready && !error ? (
          <p className="poster-footer">
            Не нашли подходящее время? <Link to="/enquiry">Оставить заявку</Link> — поможем
            подобрать занятие. Заявка не резервирует место.
          </p>
        ) : null}
      </div>
      <noscript>
        <style>{`.schedule-enhanced { display: none !important; }`}</style>
        <div className="schedule-static">
          <p>
            Чтобы посмотреть расписание здесь, включите выполнение сценариев в настройках браузера.
            Вы также можете выбрать занятие в форме заявки или попросить помочь с подбором времени.
          </p>
          <Link to="/enquiry" className="button">
            Оставить заявку
          </Link>
        </div>
      </noscript>
    </section>
  );
}
