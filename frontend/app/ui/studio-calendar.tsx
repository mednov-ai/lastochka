import { NEW_SESSION_MINUTES } from './duration-input';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { components } from '../api/schema';
import { Status } from './workspace';
import { addDays, dateKey, dayStart, dayLabel, timeLabel } from './calendar-time';
type Session = components['schemas']['SessionView'];
type Membership = components['schemas']['SessionMembership'];
export const calendarGeometry = {
  pixelsPerMinute: 1,
  stepMinutes: 15,
  firstMinute: 480,
  lastMinute: 1320,
};
type Ghost = { day: string; start: number; end: number };
type Gesture = {
  kind: 'select' | 'move' | 'resize';
  day: string;
  start: number;
  x: number;
  y: number;
  offset: number;
  session?: Session;
  moved: boolean;
};
function eventLanes(items: Session[]) {
  const result = new Map<string, { lane: number; lanes: number }>();
  let group: Session[] = [],
    until = -Infinity;
  const finish = () => {
    const ends: number[] = [],
      assigned: { id: string; lane: number }[] = [];
    for (const item of group) {
      const start = new Date(item.startsAt).valueOf();
      let lane = ends.findIndex((end) => end <= start);
      if (lane < 0) lane = ends.length;
      ends[lane] = new Date(item.endsAt).valueOf();
      assigned.push({ id: item.id, lane });
    }
    for (const item of assigned) result.set(item.id, { lane: item.lane, lanes: ends.length });
  };
  for (const item of [...items].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id),
  )) {
    if (new Date(item.startsAt).valueOf() >= until) {
      finish();
      group = [];
    }
    group.push(item);
    until = Math.max(...group.map((s) => new Date(s.endsAt).valueOf()));
  }
  finish();
  return result;
}
export function StudioCalendar({
  date,
  selectedDate,
  sessions,
  mode,
  onSelect,
  onMove,
  onResize,
  onCreate,
  onDaySelect,
  onSeriesSelect,
  selectedId,
  memberships = [],
  drafts = [],
}: {
  selectedId?: string | null;
  date: string;
  selectedDate: string;
  sessions: Session[];
  mode: 'day' | 'week' | 'list';
  onSelect: (session: Session) => void;
  onMove: (session: Session, starts: string) => void;
  onResize: (session: Session, ends: string) => void;
  onCreate: (starts: string, duration?: number) => void;
  onDaySelect: (date: string) => void;
  onSeriesSelect: (id: string) => void;
  memberships?: Membership[];
  drafts?: components['schemas']['SeriesPlan'][];
}) {
  const handledClick = useRef(false);
  const statusNames: Record<string, string> = {
    OPEN: 'Приём открыт',
    CLOSED: 'Приём закрыт',
    CANCELLED: 'Отменено',
    DRAFT: 'Черновик',
  };
  const candidateSeries = new Map<string, string>();
  const candidates: Session[] = drafts.flatMap((plan) =>
    (plan.items ?? [])
      .filter((row) => row.action === 'CREATE' && row.proposed && plan.seriesId)
      .map((row) => {
        const id = `series-draft:${plan.seriesId}:${row.originalDate}`;
        candidateSeries.set(id, plan.seriesId!);
        return { ...row.proposed!, id, status: 'DRAFT', version: 0, zone: 'Europe/Moscow' };
      }),
  );
  const calendarItems = [...sessions, ...candidates];
  const root = useRef<HTMLElement>(null),
    gesture = useRef<Gesture | null>(null),
    ghostRef = useRef<Ghost | null>(null);
  const [canDrag, setCanDrag] = useState(false),
    [ghost, setGhost] = useState<Ghost | null>(null);
  const setProposal = (value: Ghost | null) => {
    ghostRef.current = value;
    setGhost(value);
  };
  useEffect(() => {
    const media = matchMedia('(pointer: fine)');
    const update = () => setCanDrag(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && gesture.current) {
        e.preventDefault();
        gesture.current = null;
        setProposal(null);
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  const days = Array.from({ length: mode === 'day' ? 1 : 7 }, (_, i) => addDays(date, i));
  const minutes = (v: string, d: string) => (new Date(v).valueOf() - dayStart(d).valueOf()) / 60000;
  const byDay = new Map(
    days.map((d) => [
      d,
      calendarItems.filter(
        (s) =>
          new Date(s.startsAt).valueOf() < dayStart(d).valueOf() + 86400000 &&
          new Date(s.endsAt).valueOf() > dayStart(d).valueOf(),
      ),
    ]),
  );
  const first =
    Math.floor(
      Math.min(
        calendarGeometry.firstMinute,
        ...days.flatMap((d) =>
          (byDay.get(d) ?? []).map((s) => Math.max(0, minutes(s.startsAt, d))),
        ),
      ) / 60,
    ) * 60;
  const last =
    Math.ceil(
      Math.max(
        calendarGeometry.lastMinute,
        ...days.flatMap((d) =>
          (byDay.get(d) ?? []).map((s) => Math.min(1440, minutes(s.endsAt, d))),
        ),
      ) / 60,
    ) * 60;
  const scale = calendarGeometry.pixelsPerMinute;
  const instant = (d: string, m: number) =>
    new Date(dayStart(d).valueOf() + m * 60000).toISOString();
  const membership = new Map(memberships.map((m) => [m.sessionId, m]));
  const label = (d: string) =>
    dayLabel.format(dayStart(d)).replace(/^[а-яё]/u, (c) => c.toUpperCase());
  function point(e: ReactPointerEvent, d: string) {
    const day = root.current?.querySelector<HTMLElement>(`[data-day="${d}"]`);
    return Math.max(
      first,
      Math.min(last, first + (e.clientY - (day?.getBoundingClientRect().top ?? 0)) / scale),
    );
  }
  function begin(e: ReactPointerEvent, day: string, kind: Gesture['kind'], s?: Session) {
    handledClick.current = false;
    if (!canDrag || e.button !== 0 || e.pointerType === 'touch') return;
    if (s && (s.status === 'CANCELLED' || new Date(s.startsAt).valueOf() <= Date.now())) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget instanceof HTMLButtonElement)
      e.currentTarget.focus({ preventScroll: true });
    const minute = point(e, day),
      start = Math.round(minute / calendarGeometry.stepMinutes) * calendarGeometry.stepMinutes;
    gesture.current = {
      kind,
      day,
      start,
      x: e.clientX,
      y: e.clientY,
      offset: s ? minute - minutes(s.startsAt, day) : 0,
      session: s,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e: ReactPointerEvent) {
    const g = gesture.current;
    if (!g) return;
    if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 5 && !g.moved) return;
    g.moved = true;
    let day = g.day;
    if (g.kind === 'move')
      day =
        document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-day]')?.dataset
          .day ?? day;
    const m = Math.round(point(e, day) / 15) * 15;
    if (g.kind === 'select')
      setProposal({ day: g.day, start: Math.min(g.start, m), end: Math.max(g.start + 15, m) });
    else if (g.kind === 'resize' && g.session) {
      const start = minutes(g.session.startsAt, g.day);
      setProposal({ day: g.day, start, end: Math.max(start + 15, m) });
    } else if (g.session) {
      const start = Math.max(0, Math.min(1425, Math.round((point(e, day) - g.offset) / 15) * 15));
      setProposal({
        day,
        start,
        end:
          start +
          (new Date(g.session.endsAt).valueOf() - new Date(g.session.startsAt).valueOf()) / 60000,
      });
    }
  }
  function finish() {
    const g = gesture.current,
      p = ghostRef.current;
    gesture.current = null;
    setProposal(null);
    if (!g) return;
    handledClick.current = true;
    if (!g.moved) {
      if (g.session) onSelect(g.session);
      else onCreate(instant(g.day, Math.min(g.start, 1439)), NEW_SESSION_MINUTES);
      return;
    }
    if (!p) return;
    if (g.kind === 'select') onCreate(instant(p.day, p.start), p.end - p.start);
    else if (g.kind === 'resize' && g.session) onResize(g.session, instant(p.day, p.end));
    else if (g.session) onMove(g.session, instant(p.day, p.start));
  }
  const cancelGesture = () => {
    gesture.current = null;
    setProposal(null);
  };
  useEffect(() => {
    if (!selectedId) return;
    root.current
      ?.querySelector<HTMLElement>(`[data-session-id="${selectedId}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedId, date]);
  const agenda = (day: string) => (
    <section key={day} className="agenda-day">
      <h3>{label(day)}</h3>
      <button
        type="button"
        className="button light"
        onClick={(e) => {
          e.currentTarget.focus({ preventScroll: true });
          onCreate(instant(day, 17 * 60));
        }}
      >
        Создать занятие на этот день
      </button>
      {(byDay.get(day) ?? []).length ? (
        (byDay.get(day) ?? []).map((s) => (
          <article className={`list-card ${s.id === selectedId ? 'selected' : ''}`} key={s.id}>
            <div>
              <h3>{s.title}</h3>
              <p>
                {timeLabel.format(new Date(s.startsAt))}–{timeLabel.format(new Date(s.endsAt))} МСК
              </p>
              <Status value={s.status} />
              <p>Размер группы: {s.capacity}</p>
              {membership.get(s.id) ? (
                <p>
                  {membership.get(s.id)?.groupName}
                  {membership.get(s.id)?.exception ? ' · Разовое изменение' : ''}
                </p>
              ) : null}
            </div>
            <button
              className="button light"
              onClick={(e) => {
                e.currentTarget.focus({ preventScroll: true });
                const id = candidateSeries.get(s.id);
                if (id) onSeriesSelect(id);
                else onSelect(s);
              }}
            >
              {candidateSeries.has(s.id) ? 'Открыть черновик серии' : 'Открыть занятие'}
            </button>
          </article>
        ))
      ) : (
        <p className="muted">Занятий нет</p>
      )}
    </section>
  );
  return (
    <section
      ref={root}
      className="studio-calendar"
      aria-label="Календарь студии"
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={cancelGesture}
      onLostPointerCapture={cancelGesture}
    >
      <p className="muted">
        Время по Москве. Нажмите свободное время, чтобы создать занятие. Длительность можно выбрать
        протягиванием вниз.
      </p>
      {mode !== 'list' ? (
        <>
          <div className="calendar-desktop">
            <div
              className="time-calendar"
              style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}
            >
              <div className="time-corner" aria-hidden="true">
                МСК
              </div>
              {days.map((d) => (
                <div
                  className={`time-day-title ${d === dateKey(new Date()) ? 'today' : ''}`}
                  key={d}
                >
                  <button type="button" onClick={() => onDaySelect(d)}>
                    {label(d)}
                    {d === dateKey(new Date()) ? <small>Сегодня</small> : null}
                  </button>
                  <button
                    type="button"
                    className="day-create"
                    aria-label={`Создать занятие: ${label(d)}`}
                    onClick={() => onCreate(instant(d, 17 * 60))}
                  >
                    ＋
                  </button>
                </div>
              ))}
              <div className="time-axis" style={{ height: (last - first) * scale }}>
                {Array.from({ length: (last - first) / 60 + 1 }, (_, i) => (
                  <span key={i} style={{ top: i * 60 * scale }}>
                    {String(first / 60 + i).padStart(2, '0')}:00
                  </span>
                ))}
              </div>
              {days.map((d) => {
                const lanes = eventLanes(byDay.get(d) ?? []);
                return (
                  <div
                    key={d}
                    className="time-day"
                    data-day={d}
                    style={{ height: (last - first) * scale }}
                    onPointerDown={(e) => {
                      if (e.target === e.currentTarget) begin(e, d, 'select');
                    }}
                  >
                    {(byDay.get(d) ?? []).map((s) => {
                      const lane = lanes.get(s.id),
                        m = membership.get(s.id),
                        candidate = candidateSeries.get(s.id),
                        eventName =
                          m?.groupName && m.groupName !== s.title
                            ? m.groupName + ' · ' + s.title
                            : s.title,
                        eventHeight =
                          (Math.min(last, minutes(s.endsAt, d)) -
                            Math.max(first, minutes(s.startsAt, d))) *
                          scale,
                        editable =
                          !candidate &&
                          s.status !== 'CANCELLED' &&
                          new Date(s.startsAt).valueOf() > Date.now();
                      return (
                        <div
                          key={s.id}
                          data-session-id={candidate ? undefined : s.id}
                          className={`calendar-event ${s.status} ${eventHeight < 45 ? 'compact' : ''} ${s.id === selectedId ? 'selected' : ''}`}
                          style={{
                            left: `calc(${((lane?.lane ?? 0) * 100) / (lane?.lanes ?? 1)}% + 2px)`,
                            width: `calc(${100 / (lane?.lanes ?? 1)}% - 4px)`,
                            top: (Math.max(first, minutes(s.startsAt, d)) - first) * scale,
                            height:
                              (Math.min(last, minutes(s.endsAt, d)) -
                                Math.max(first, minutes(s.startsAt, d))) *
                              scale,
                          }}
                        >
                          <button
                            type="button"
                            className="calendar-event-body"
                            aria-label={`${timeLabel.format(new Date(s.startsAt))}–${timeLabel.format(new Date(s.endsAt))}, ${eventName}, ${candidate ? 'Черновик серии' : statusNames[s.status]}${m ? ', ' + m.groupName : ''}${m?.exception ? ', разовое изменение' : ''}`}
                            onPointerDown={(e) => {
                              if (!candidate) begin(e, d, 'move', s);
                              else handledClick.current = false;
                            }}
                            onClick={(e) => {
                              e.currentTarget.focus({ preventScroll: true });
                              if (candidate) onSeriesSelect(candidate);
                              else if (e.detail === 0 || !handledClick.current) onSelect(s);
                              handledClick.current = false;
                            }}
                          >
                            <strong>
                              {timeLabel.format(new Date(s.startsAt))}–
                              {timeLabel.format(new Date(s.endsAt))}
                            </strong>
                            <span>
                              {candidate
                                ? 'Черновик серии · '
                                : s.status !== 'OPEN'
                                  ? statusNames[s.status] + ' · '
                                  : ''}
                              {eventName}
                            </span>
                            {m?.exception ? (
                              <span className="event-exception" aria-hidden="true">
                                ↗
                              </span>
                            ) : null}
                          </button>
                          {editable ? (
                            <button
                              type="button"
                              className="event-resize"
                              aria-label={`Изменить длительность: ${s.title}`}
                              onPointerDown={(e) => begin(e, d, 'resize', s)}
                              onClick={(e) => {
                                e.currentTarget.focus({ preventScroll: true });
                                if (e.detail === 0 || !handledClick.current) onResize(s, s.endsAt);
                                handledClick.current = false;
                              }}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                    {ghost?.day === d ? (
                      <div
                        className="calendar-ghost"
                        role="status"
                        style={{
                          top: (ghost.start - first) * scale,
                          height: (ghost.end - ghost.start) * scale,
                        }}
                      >
                        {timeLabel.format(new Date(instant(d, ghost.start)))}–
                        {timeLabel.format(new Date(instant(d, ghost.end)))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="calendar-mobile">
            <nav className="calendar-day-picker" aria-label="Дни недели">
              {days.map((d) => (
                <button
                  className="button light"
                  type="button"
                  key={d}
                  aria-pressed={d === selectedDate}
                  onClick={() => onDaySelect(d)}
                >
                  {label(d)}
                </button>
              ))}
            </nav>
            {agenda(selectedDate)}
          </div>
        </>
      ) : (
        <div className="calendar-list">{days.map(agenda)}</div>
      )}
    </section>
  );
}
