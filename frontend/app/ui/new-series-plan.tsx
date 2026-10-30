import { useState } from 'react';
import type { components } from '../api/schema';
import { SessionDetails } from './session-card';
import { hasConflict } from './series-conflicts';
import { SeriesPlanTable } from './series-plan-table';

type Plan = components['schemas']['SeriesPlan'];
type Rule = components['schemas']['SeriesRule'];

export function NewSeriesPlan({ plan, rule }: { plan: Plan; rule: Rule }) {
  const [page, setPage] = useState(0);
  const [card, setCard] = useState(false);
  const [focusError, setFocusError] = useState(0);
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const firstConflict = plan.items.findIndex(hasConflict);
  const sample = plan.items.find((row) => row.proposed)?.proposed;
  return (
    <section className="series-plan" aria-label="Предпросмотр серии">
      <p>
        {rule.startDate} — {rule.endDate} ·{' '}
        {rule.weekdays.map((day) => ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'][day - 1]).join(', ')}{' '}
        · {rule.startTime.slice(0, 5)} МСК · {rule.durationMinutes} мин
      </p>
      <p>
        Добавится: {plan.creates} · изменится: {plan.changes} · отменится: {plan.cancellations} ·
        сохранится: {plan.retained}. Всего дат: {plan.total}.
      </p>
      {firstConflict >= 0 ? (
        <p className="notice error">
          Некоторые даты требуют исправления. Причины указаны в таблице.{' '}
          <button
            type="button"
            className="button light"
            onClick={() => {
              setCard(false);
              setPage(Math.floor(firstConflict / 10));
              setFocusError((value) => value + 1);
            }}
          >
            К первому конфликту
          </button>
        </p>
      ) : null}
      {card ? (
        <>
          <div className="editor-device">
            <button
              type="button"
              className="button light"
              aria-pressed={device === 'desktop'}
              onClick={() => setDevice('desktop')}
            >
              Компьютер
            </button>
            <button
              type="button"
              className="button light"
              aria-pressed={device === 'mobile'}
              onClick={() => setDevice('mobile')}
            >
              Телефон
            </button>
          </div>
          <div className={'series-preview ' + device}>
            {sample ? <SessionDetails session={sample} headingLevel={4} /> : null}
          </div>
          <p>Это предпросмотр. Отправка заявки недоступна.</p>
        </>
      ) : (
        <SeriesPlanTable
          rows={plan.items.slice(page * 10, page * 10 + 10)}
          focusError={focusError}
        />
      )}
      <nav className="plan-pagination" aria-label="Страницы плана">
        <button
          type="button"
          className="button light"
          disabled={!page}
          onClick={() => {
            setFocusError(0);
            setPage((value) => value - 1);
          }}
        >
          Предыдущие даты
        </button>
        <span>
          {page * 10 + 1}–{Math.min(plan.total, (page + 1) * 10)} из {plan.total}
        </span>
        <button
          type="button"
          className="button light"
          disabled={(page + 1) * 10 >= plan.total}
          onClick={() => {
            setFocusError(0);
            setPage((value) => value + 1);
          }}
        >
          Следующие даты
        </button>
        <button
          type="button"
          className="button light"
          onClick={() => {
            setFocusError(0);
            setCard((value) => !value);
          }}
        >
          {card ? 'Даты плана' : 'Вид карточки'}
        </button>
      </nav>
      {!plan.canPublish ? (
        <p className="notice error">Публикация недоступна: проверьте указанные даты.</p>
      ) : null}
    </section>
  );
}
