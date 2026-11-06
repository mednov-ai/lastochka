import { useEffect, useState } from 'react';
import { api, message } from '../api/client';
import type { components } from '../api/schema';
import { SessionDetails } from './session-card';
import { moscow, Status } from './workspace';

type Session = components['schemas']['SessionView'];
type Group = components['schemas']['ScheduleGroupView'];
type Series = components['schemas']['SessionSeriesView'];

export function ScheduleSessionReadOnly({ session }: { session: Session }) {
  const [history, setHistory] = useState<components['schemas']['SessionHistory'] | null>(null);
  const [draft, setDraft] = useState<components['schemas']['SessionDraftView']>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void api
      .GET('/api/v1/admin/sessions/{id}/draft', { params: { path: { id: session.id } } })
      .then((result) => {
        if (!active) return;
        if (result.error) setError(message(result.error));
        else setDraft(result.data.draft ?? null);
      });
    return () => {
      active = false;
    };
  }, [session.id]);
  async function load(page = 0) {
    const response = await api.GET('/api/v1/admin/sessions/{id}/history', {
      params: { path: { id: session.id }, query: { page } },
    });
    if (response.error) setError(message(response.error));
    else setHistory(response.data);
  }
  return (
    <div className="stack">
      <SessionDetails session={session} />
      <Status value={session.status} />
      {draft ? (
        <section>
          <h3>Неопубликованный черновик</h3>
          <SessionDetails session={draft.session} headingLevel={4} />
          <p>
            {draft.author} · {moscow(draft.updatedAt)}
          </p>
        </section>
      ) : null}
      <button className="button light" onClick={() => void load()}>
        История изменений
      </button>
      {error ? (
        <p role="alert" className="notice error">
          {error}
        </p>
      ) : null}
      {history ? (
        <section>
          <h3>История изменений</h3>
          {history.items.map((item) => (
            <article className="list-card" key={item.id}>
              <div>
                <p>
                  {moscow(item.occurredAt)} · {item.author}
                </p>
                {item.after ? <SessionDetails session={item.after} headingLevel={4} /> : null}
              </div>
            </article>
          ))}
          <div className="toolbar">
            <button
              className="button light"
              disabled={history.page === 0}
              onClick={() => void load(history.page - 1)}
            >
              Назад
            </button>
            <span>Страница {history.page + 1}</span>
            <button
              className="button light"
              disabled={(history.page + 1) * 20 >= history.total}
              onClick={() => void load(history.page + 1)}
            >
              Далее
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function ScheduleGroupsReadOnly({ groups }: { groups: Group[] }) {
  const [series, setSeries] = useState<Series[]>([]);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<components['schemas']['RecurrenceHistory'] | null>(null);
  const [target, setTarget] = useState<{ id: string; group: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    void api.GET('/api/v1/admin/session-series').then((result) => {
      if (!active) return;
      if (result.error) setError(message(result.error));
      else setSeries(result.data.items);
    });
    return () => {
      active = false;
    };
  }, []);
  async function loadHistory(id: string, group: boolean, page = 0) {
    const params = { path: { id }, query: { page } };
    const result = group
      ? await api.GET('/api/v1/admin/schedule-groups/{id}/history', { params })
      : await api.GET('/api/v1/admin/session-series/{id}/history', { params });
    if (result.error) setError(message(result.error));
    else {
      setTarget({ id, group });
      setHistory(result.data);
    }
  }
  return (
    <div className="stack">
      {error ? (
        <p role="alert" className="notice error">
          {error}
        </p>
      ) : null}
      {groups.map((group) => (
        <section className="list-card" key={group.id}>
          <div>
            <h3>{group.parameters.name}</h3>
            <p>Размер группы: {group.parameters.capacity}</p>
            <button className="button light" onClick={() => void loadHistory(group.id, true)}>
              История группы
            </button>
            {series
              .filter((item) => item.groupId === group.id)
              .map((item) => (
                <div key={item.id}>
                  {item.rule ? (
                    <p>
                      {item.rule.title}: {item.rule.startDate} — {item.rule.endDate},{' '}
                      {item.rule.startTime} МСК
                    </p>
                  ) : (
                    <p>Неопубликованное расписание</p>
                  )}
                  {item.draft?.rule ? (
                    <p>
                      Черновик: {item.draft.rule.title} · {item.draft.rule.startDate} —{' '}
                      {item.draft.rule.endDate}, {item.draft.rule.startTime} МСК
                    </p>
                  ) : null}
                  <button className="button light" onClick={() => void loadHistory(item.id, false)}>
                    История расписания
                  </button>
                </div>
              ))}
          </div>
        </section>
      ))}
      {!groups.length ? <p>Групп пока нет.</p> : null}
      {history && target ? (
        <section>
          <h3>{target.group ? 'История группы' : 'История расписания'}</h3>
          {history.items.map((item) => (
            <article className="list-card" key={item.id}>
              <div>
                <p>
                  {moscow(item.occurredAt)} · {item.author} · дат: {item.affected}
                </p>
                {item.rule ? (
                  <p>
                    {item.rule.title} · {item.rule.startDate} — {item.rule.endDate} ·{' '}
                    {item.rule.startTime} МСК
                  </p>
                ) : null}
                {item.groupParameters ? (
                  <p>
                    {item.groupParameters.name} · до {item.groupParameters.capacity} человек
                  </p>
                ) : null}
              </div>
            </article>
          ))}
          <div className="toolbar">
            <button
              className="button light"
              disabled={history.page === 0}
              onClick={() => void loadHistory(target.id, target.group, history.page - 1)}
            >
              Назад
            </button>
            <span>Страница {history.page + 1}</span>
            <button
              className="button light"
              disabled={(history.page + 1) * 20 >= history.total}
              onClick={() => void loadHistory(target.id, target.group, history.page + 1)}
            >
              Далее
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
