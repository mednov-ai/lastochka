import { addDays, dateKey, dayLabel, dayStart, monday } from './calendar-time';
export function currentWeek() {
  return monday(dateKey(new Date()));
}
export function SchedulePeriod({
  date,
  onChange,
}: {
  date: string;
  onChange: (date: string) => void;
}) {
  return (
    <section className="schedule-period" aria-label="Выбор недели">
      <p className="period-title" role="status">
        {dayLabel.format(dayStart(date)).toLowerCase()} —{' '}
        {dayLabel.format(dayStart(addDays(date, 6))).toLowerCase()}
      </p>
      <div className="period-controls">
        <div className="period-shortcuts" role="group" aria-label="Быстрый выбор недели">
          <button className="button light" onClick={() => onChange(currentWeek())}>
            Эта неделя
          </button>
          <button className="button light" onClick={() => onChange(addDays(currentWeek(), 7))}>
            Следующая неделя
          </button>
        </div>
        <div className="period-navigation" role="group" aria-label="Переход по неделям">
          <button
            className="button light"
            aria-label="Предыдущая неделя"
            onClick={() => onChange(addDays(date, -7))}
          >
            ←
          </button>
          <label>
            <span>Дата</span>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                if (e.target.value) onChange(monday(e.target.value));
              }}
            />
          </label>
          <button
            className="button light"
            aria-label="Следующий период"
            onClick={() => onChange(addDays(date, 7))}
          >
            →
          </button>
        </div>
      </div>
    </section>
  );
}
