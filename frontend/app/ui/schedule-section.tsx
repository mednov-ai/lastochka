import { Words } from './words';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { uiText } from './ui-texts';
import './schedule-table.css';

export function ScheduleFrame({ children }: { children: ReactNode }) {
  return (
    <section id="schedule" className="public-schedule" aria-labelledby="schedule-heading">
      <div className="poster-intro">
        <p className="landing-kicker">Выберите удобное время</p>
        <h2 id="schedule-heading">
          <Words text="Расписание занятий" />
        </h2>
        <p className="poster-badge">{uiText.scheduleFilling}</p>
        <p className="poster-lead">
          Выберите время в таблице или оставьте заявку — поможем подобрать группу.{' '}
          {uiText.scheduleTimeZone}.
        </p>
      </div>
      {children}
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
