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
  return <><p>Для каждого времени можно изменить будущие занятия с выбранной даты.</p>
    <ul className="permanent-date-list">{rules.slice(page * 20, page * 20 + 20).map((rule) => <li key={rule.seriesId}>
      <span><strong>{rule.title}</strong> · {weekdays[rule.weekday - 1]}, {rule.time.slice(0, 5)} МСК · с {dayLabel.format(dayStart(rule.startDate))}{rule.endDateExclusive ? ` · до ${dayLabel.format(dayStart(addDays(rule.endDateExclusive, -1)))}` : ''}</span>
      {editable ? <button className="button light" type="button" onClick={() => onEdit(rule)}>Изменить расписание</button> : null}
    </li>)}</ul>
    <Pager label="Расписание" page={page} total={rules.length} size={20} onChange={setPage} /></>;
}
