import { useEffect, useState, useRef, useId } from 'react';
import { Link } from 'react-router';
import { api, message } from '../api/client';
import type { components } from '../api/schema';
import { Pager } from './pager';
import { addDays, dayStart } from './calendar-time';
import { SessionCard, sessionDays } from './session-card';
import { SchedulePeriod, currentWeek } from './schedule-period';
export function ScheduleSection() {
  const [date, setDate] = useState(currentWeek);
  const [page, setPage] = useState(0);
  const [value, setValue] = useState<components['schemas']['SessionPage'] | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const emptyTitle = useId();
  const empty = value?.items.length === 0;
  useEffect(() => {
    const n = ++generation.current;
    setValue(null);
    setError('');
    void api
      .GET('/api/v1/sessions', {
        params: {
          query: {
            from: dayStart(date).toISOString(),
            to: dayStart(addDays(date, 7)).toISOString(),
            page,
            size: 20,
          },
        },
      })
      .then((r) => {
        if (n !== generation.current) return;
        if (r.error) setError(message(r.error));
        else setValue(r.data);
      });
    return () => {
      generation.current++;
    };
  }, [date, page, retry]);
  return (
    <section id="schedule" className="section public-schedule" aria-labelledby="schedule-heading">
      <p className="eyebrow">ВЫБЕРИТЕ УДОБНОЕ ВРЕМЯ</p>
      <h2 id="schedule-heading">Расписание занятий</h2>
      <p>Время по Москве. Выберите занятие — администратор свяжется с вами для согласования.</p>
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
        <div className="stack">
          {sessionDays(value?.items ?? []).map((day) => (
            <section className="public-schedule-day" key={day.day}>
              <h3>{day.label}</h3>
              <div className="stack">
                {day.sessions.map((s) => (
                  <SessionCard key={s.id} session={s} headingLevel={4}>
                    {s.status === 'OPEN' ? (
                      <Link className="button" to={'/enquiry?session=' + s.id}>
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
        {value ? (
          <Pager label="Расписание" page={page} total={value.total} size={20} onChange={setPage} />
        ) : null}
        {!empty ? (
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
