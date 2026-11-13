import { useEffect, useState, useRef, useId } from 'react';
import { Link } from 'react-router';
import { message } from '../api/client';
import { Pager } from './pager';
import { addDays, dayLabel, dayStart, timeLabel } from './calendar-time';
import { SessionCard, sessionDays } from './session-card';
import { enquiryLink, type ScheduleEntry } from './schedule-occurrence';
import { SchedulePeriod, currentWeek } from './schedule-period';
import { loadScheduleProjection } from './schedule-projection';
import './schedule-table.css';
export function ScheduleSection() {
  const [date, setDate] = useState(currentWeek);
  const [page, setPage] = useState(0);
  const [value, setValue] = useState<ScheduleEntry[] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const emptyTitle = useId();
  const empty = value?.length === 0;
  const visible = (value ?? []).slice(page * 20, page * 20 + 20);
  const loadedDays = sessionDays(visible);
  const days =
    value && value.length <= 20
      ? Array.from({ length: 7 }, (_, index) => addDays(date, index))
          .map(
            (day) =>
              loadedDays.find((item) => item.day === day) ?? {
                day,
                label: dayLabel.format(dayStart(day)),
                sessions: [],
              },
          )
          .filter((day, index) => index < 6 || day.sessions.length > 0)
      : loadedDays;
  useEffect(() => {
    const n = ++generation.current;
    setValue(null);
    setError('');
    void loadScheduleProjection(dayStart(date).toISOString(), dayStart(addDays(date, 7)).toISOString())
      .then((items) => {
        if (n !== generation.current) return;
        setValue(items);
      })
      .catch((err) => {
        if (n === generation.current)
          setError(err instanceof Error ? 'Не удалось загрузить расписание. Попробуйте ещё раз.' : message(err));
      });
    return () => {
      generation.current++;
    };
  }, [date, retry]);
  return (
    <section id="schedule" className="section public-schedule" aria-labelledby="schedule-heading">
      <h2 id="schedule-heading">Расписание занятий</h2>
      <p>Группы формируются. Выберите занятие или оставьте заявку — поможем подобрать группу.</p>
      <p>Время указано по Москве.</p>
      <div className="schedule-enhanced">
        <SchedulePeriod
          date={date}
          onChange={(d) => {
            setDate(d);
            setPage(0);
          }}
        />
        {error ? (
          <div className="notice error" role="alert">
            <p>{error}</p>
            <button className="button light" onClick={() => setRetry((x) => x + 1)}>
              Повторить загрузку
            </button>
          </div>
        ) : null}
        {!value && !error ? <p role="status">Загрузка расписания…</p> : null}
        {empty ? (
          <section className="schedule-empty" aria-labelledby={emptyTitle}>
            <h3 id={emptyTitle}>На этой неделе пока нет занятий</h3>
            <p>Посмотрите другую неделю или оставьте заявку — поможем подобрать удобное время.</p>
            <p className="schedule-disclaimer">Заявка не резервирует место.</p>
            <Link to="/enquiry" className="button">
              Оставить общую заявку
            </Link>
          </section>
        ) : null}
        {value && !empty ? (
          <>
            {visible.length === 0 ? (
              <p>На этой странице занятий нет. Вернитесь к предыдущей странице.</p>
            ) : null}
            {value.length > 20 ? (
              <p className="schedule-page-note">
                Показана часть занятий за неделю. Остальные — на других страницах.
              </p>
            ) : null}
            <div className="schedule-table" role="table" aria-label="Занятия по дням">
              <div className="schedule-table-head" role="row">
                <span role="columnheader">День</span>
                <span role="columnheader">Занятия</span>
              </div>
              {days.map((day) => (
                <section className="schedule-table-row" role="row" key={day.day}>
                  <div role="rowheader">
                    <h3>{day.label}</h3>
                  </div>
                  <div role="cell" className="schedule-table-sessions">
                    {day.sessions.length === 0 ? <p>Пока нет занятий</p> : null}
                    {day.sessions.map((s) => (
                      <SessionCard
                        key={s.key}
                        session={s.summary}
                        headingLevel={4}
                        showCapacity={false}
                      >
                        {s.status === 'OPEN' && new Date(s.startsAt).valueOf() > Date.now() ? (
                          <Link
                            className="button light"
                            to={enquiryLink(s)}
                            aria-label={`Оставить заявку: ${s.summary.title}, ${day.label}, ${timeLabel.format(new Date(s.startsAt))}`}
                          >
                            Оставить заявку
                          </Link>
                        ) : (
                          <p className="muted">Приём заявок закрыт</p>
                        )}
                      </SessionCard>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        ) : null}
        {value ? (
          <Pager label="Расписание" page={page} total={value.length} size={20} onChange={setPage} />
        ) : null}
        {value && !empty ? (
          <aside className="general-enquiry">
            <h3>Не нашли подходящее время?</h3>
            <p>Поможем подобрать занятие. Заявка не резервирует место.</p>
            <Link to="/enquiry" className="button light">
              Оставить общую заявку
            </Link>
          </aside>
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
