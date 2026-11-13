import { useEffect, useState } from 'react';
import { api, message } from '../api/client';
import type { components } from '../api/schema';
import { addDays, dayLabel, dayStart } from './calendar-time';
import { Pager } from './pager';

type Rule = components['schemas']['PermanentRuleView'];
const weekdays = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

export function PermanentRules({ editable, onEdit }: { editable: boolean; onEdit: (rule: Rule) => void }) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState('');
  const [weekday, setWeekday] = useState('');
  useEffect(() => {
    let active = true;
    void api.GET('/api/v1/admin/permanent-schedule').then((response) => {
      if (response.error) throw response.error;
      if (!Array.isArray(response.data.items)) throw new Error('Не удалось проверить расписание.');
      if (active) setRules(response.data.items);
    }).catch((err) => { if (active) setError(message(err)); });
    return () => { active = false; };
  }, []);
  if (error) return <p role="alert" className="notice error">{error}</p>;
  if (!rules) return <p role="status">Загрузка расписания…</p>;
  if (!rules.length) return <p>Постоянное расписание ещё не создано.</p>;
  const directions = [...new Map(rules.map((rule) => [rule.directionId, rule.title])).entries()];
  const filtered = rules.filter((rule) => (!direction || rule.directionId === direction) && (!weekday || rule.weekday === Number(weekday)));
  return <><p>Изменение правила действует на будущие занятия с выбранной даты. Разовые переносы и отмены сохранятся. Одно занятие можно изменить в календаре.</p>
    <div className="permanent-rule-filters">
      <label>Направление<select value={direction} onChange={(event) => { setDirection(event.target.value); setPage(0); }}><option value="">Все направления</option>{directions.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
      <label>День недели<select value={weekday} onChange={(event) => { setWeekday(event.target.value); setPage(0); }}><option value="">Все дни</option>{weekdays.map((name, i) => <option value={i + 1} key={name}>{name}</option>)}</select></label>
      {(direction || weekday) ? <button className="button light" type="button" onClick={() => { setDirection(''); setWeekday(''); setPage(0); }}>Сбросить фильтры</button> : null}
    </div>
    {!filtered.length ? <p>Подходящих правил нет. Измените или сбросьте фильтры.</p> : null}
    <ul className="permanent-date-list">{filtered.slice(page * 20, page * 20 + 20).map((rule) => <li key={rule.seriesId}>
      <span><strong>{rule.title}</strong> · {weekdays[rule.weekday - 1]}, {rule.time.slice(0, 5)} МСК · с {dayLabel.format(dayStart(rule.startDate))}{rule.endDateExclusive ? ` · до ${dayLabel.format(dayStart(addDays(rule.endDateExclusive, -1)))}` : ''}</span>
      {editable ? <button className="button light" type="button" aria-label={`Изменить расписание: ${rule.title}, ${weekdays[rule.weekday - 1]}, ${rule.time.slice(0, 5)}`} onClick={() => onEdit(rule)}>Изменить расписание</button> : null}
    </li>)}</ul>
    <Pager label="Расписание" page={page} total={filtered.length} size={20} onChange={setPage} /></>;
}
