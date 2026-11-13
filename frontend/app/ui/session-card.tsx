import type { ReactNode } from 'react';
import type { components } from '../api/schema';
import { dateKey, dayLabel, dayStart, timeLabel } from './calendar-time';
export type PublicSession = components['schemas']['SessionView'];
export type SessionSummary = Pick<
  PublicSession,
  'title' | 'startsAt' | 'endsAt' | 'format' | 'capacity' | 'ageFrom' | 'ageTo'
> & { ageOpenEnded?: boolean | null };
export function SessionDetails({
  session: s,
  headingLevel = 2,
  showCapacity = true,
}: {
  session: SessionSummary;
  headingLevel?: 2 | 3 | 4;
  showCapacity?: boolean;
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
        {s.format === 'GROUP'
          ? showCapacity
            ? `Мини-группа до ${s.capacity} человек`
            : 'Групповое занятие'
          : 'Индивидуальное занятие'}
        {s.ageFrom != null && s.ageOpenEnded
          ? ` · ${s.ageFrom}+ лет`
          : s.ageFrom != null && s.ageTo != null
            ? ` · ${s.ageFrom}–${s.ageTo} лет`
            : ''}
      </p>
    </>
  );
}
export function SessionCard({
  session,
  children,
  headingLevel,
  showCapacity = true,
}: {
  session: SessionSummary;
  children?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  showCapacity?: boolean;
}) {
  return (
    <article className="list-card session-card">
      <div>
        <SessionDetails session={session} headingLevel={headingLevel} showCapacity={showCapacity} />
      </div>
      {children}
    </article>
  );
}
export function sessionDays<T extends { startsAt: string }>(items: T[]) {
  const days = new Map<string, T[]>();
  for (const s of items) {
    const day = dateKey(s.startsAt);
    const list = days.get(day) ?? [];
    list.push(s);
    days.set(day, list);
  }
  return [...days].map(([day, sessions]) => ({
    day,
    label: dayLabel.format(dayStart(day)).toLocaleLowerCase('ru-RU'),
    sessions,
  }));
}
