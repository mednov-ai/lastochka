import type { components } from '../api/schema';
import type { SessionSummary } from './session-card';
import { dateKey, dayStart } from './calendar-time';

type Occurrence = components['schemas']['ScheduleOccurrenceView'];
type SchedulePage = components['schemas']['ProjectedSchedulePage'];
export type RuleReference = NonNullable<components['schemas']['ScheduleRuleReference']>;
export type ScheduleEntry = {
  key: string;
  startsAt: string;
  summary: SessionSummary;
  status: string;
  sessionId: string | null;
  sessionVersion: number | null;
  rule: RuleReference | null;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validReference(value: RuleReference | null | undefined): value is RuleReference {
  if (
    !value ||
    value.referenceVersion !== 1 ||
    !uuid.test(value.seriesId) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.originalDate) ||
    !Number.isSafeInteger(value.seriesVersion) ||
    value.seriesVersion < 1
  )
    return false;
  try {
    return dateKey(dayStart(value.originalDate)) === value.originalDate;
  } catch {
    return false;
  }
}
function validSummary(s: SessionSummary) {
  const start = new Date(s.startsAt).valueOf(),
    end = new Date(s.endsAt).valueOf();
  return (
    typeof s.title === 'string' &&
    s.title.trim().length > 0 &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end > start &&
    (s.format === 'GROUP' || s.format === 'INDIVIDUAL') &&
    Number.isSafeInteger(s.capacity) &&
    s.capacity > 0 &&
    (s.ageFrom == null
      ? s.ageTo == null && s.ageOpenEnded !== true
      : Number.isInteger(s.ageFrom) && s.ageFrom >= 0 && s.ageFrom <= 120 &&
        (s.ageOpenEnded === true
          ? s.ageTo == null
          : Number.isInteger(s.ageTo) && s.ageTo! >= s.ageFrom && s.ageTo! <= 120))
  );
}
export function entryFrom(value: Occurrence): ScheduleEntry {
  if (value.kind === 'SESSION' && value.session && !value.calculated) {
    const s = value.session;
    if (
      !uuid.test(s.id) ||
      !Number.isSafeInteger(s.version) ||
      s.version < 0 ||
      !['OPEN', 'CLOSED', 'CANCELLED', 'DRAFT'].includes(s.status) ||
      !validSummary(s) ||
      (value.origin && !validReference(value.origin))
    )
      throw new Error('Invalid schedule item');
    return {
      key: `session:${s.id}`,
      startsAt: s.startsAt,
      summary: s,
      status: s.status,
      sessionId: s.id,
      sessionVersion: s.version,
      rule: value.origin ?? null,
    };
  }
  if (value.kind === 'CALCULATED' && value.calculated && !value.session && !value.origin) {
    const s = value.calculated;
    const ref: RuleReference = {
      referenceVersion: 1,
      seriesId: s.seriesId,
      originalDate: s.originalDate,
      seriesVersion: s.seriesVersion,
    };
    if (s.ageFrom == null || !validReference(ref) || !validSummary({ ...s, format: 'GROUP' }))
      throw new Error('Invalid schedule reference');
    return {
      key: `rule:${ref.seriesId}:${ref.originalDate}`,
      startsAt: s.startsAt,
      summary: { ...s, format: 'GROUP' },
      status: 'OPEN',
      sessionId: null,
      sessionVersion: null,
      rule: ref,
    };
  }
  throw new Error('Invalid schedule item');
}
export function entriesFromPage(value: SchedulePage, page: number, size: number): ScheduleEntry[] {
  if (
    !value ||
    !Array.isArray(value.items) ||
    value.page !== page ||
    value.size !== size ||
    !Number.isSafeInteger(value.total) ||
    value.total < 0 ||
    typeof value.containsCalculated !== 'boolean' ||
    value.items.length !== Math.min(size, Math.max(0, value.total - page * size))
  )
    throw new Error('Invalid schedule page');
  const entries = value.items.map(entryFrom);
  if (!value.containsCalculated && entries.some((entry) => !entry.sessionId))
    throw new Error('Inconsistent calculated schedule');
  if (new Set(entries.map((item) => item.key)).size !== entries.length)
    throw new Error('Duplicate schedule item');
  return entries;
}
export function enquiryLink(entry: ScheduleEntry) {
  const query = entry.sessionId
    ? new URLSearchParams({ session: entry.sessionId })
    : new URLSearchParams({
        series: entry.rule!.seriesId,
        date: entry.rule!.originalDate,
        revision: String(entry.rule!.seriesVersion),
      });
  return `/enquiry?${query}`;
}
export function choiceValue(entry: ScheduleEntry) {
  return entry.sessionId
    ? `choose|${entry.sessionId}|${entry.sessionVersion}`
    : `choose-rule|${entry.rule!.seriesId}|${entry.rule!.originalDate}|${entry.rule!.seriesVersion}`;
}
