import type { ReactNode } from 'react';
import type { components } from '../api/schema';
import { dateKey, dayLabel, dayStart, timeLabel } from './calendar-time';
export type PublicSession = components['schemas']['SessionView'];
export function SessionDetails({
  session: s,
  headingLevel = 2,
}: {
  session: Pick<
    PublicSession,
    'title' | 'startsAt' | 'endsAt' | 'format' | 'capacity' | 'ageFrom' | 'ageTo'
  >;
  headingLevel?: 2 | 3 | 4;
}) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  const crosses = dateKey(s.startsAt) !== dateKey(s.endsAt);
  const duration =
    Math.round(((new Date(s.endsAt).valueOf() - new Date(s.startsAt).valueOf()) / 60000) * 100) /
    100;
  return (
    <>
      <Heading>{s.title}</Heading>
      <p className="session-time">
        <strong>
          {timeLabel.format(new Date(s.startsAt))}–
          {crosses ? dayLabel.format(new Date(s.endsAt)) + ', ' : ''}
          {timeLabel.format(new Date(s.endsAt))}
        </strong>{' '}
        · {duration} мин · МСК
      </p>
      <p>
        {s.format === 'GROUP' ? `Мини-группа до ${s.capacity} человек` : 'Индивидуальное занятие'}
        {s.ageFrom != null && s.ageTo != null ? ` · ${s.ageFrom}–${s.ageTo} лет` : ''}
      </p>
    </>
  );
}
export function SessionCard({
  session,
  children,
  headingLevel,
}: {
  session: PublicSession;
  children?: ReactNode;
  headingLevel?: 2 | 3 | 4;
}) {
  return (
    <article className="list-card session-card">
      <div>
        <SessionDetails session={session} headingLevel={headingLevel} />
      </div>
      {children}
    </article>
  );
}
export function sessionDays(items: PublicSession[]) {
  const days = new Map<string, PublicSession[]>();
  for (const s of items) {
    const day = dateKey(s.startsAt);
    const list = days.get(day) ?? [];
    list.push(s);
    days.set(day, list);
  }
  return [...days].map(([day, sessions]) => ({
    day,
    label: dayLabel.format(dayStart(day)),
    sessions,
  }));
}
