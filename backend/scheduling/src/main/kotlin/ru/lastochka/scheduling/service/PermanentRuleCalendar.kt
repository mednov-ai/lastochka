package ru.lastochka.scheduling.service

import ru.lastochka.common.Metadata
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters

/** Date calculation only: callers enforce revisions, exceptions and resource conflicts. */
internal object PermanentRuleCalendar {
    private val zone = ZoneId.of(Metadata.Time.STUDIO_ZONE)

    data class Revision(
        val effectiveFrom: LocalDate,
        val effectiveUntil: LocalDate?,
        val weekday: Int,
        val startTime: LocalTime,
        val durationMinutes: Int,
    ) {
        init {
            require(effectiveUntil == null || effectiveUntil > effectiveFrom)
            require(weekday in 1..Metadata.Recurrence.LAST_WEEKDAY)
            require(durationMinutes in 1 until Metadata.PermanentSchedule.MAX_DURATION_MINUTES)
        }
    }

    data class Occurrence(val originalDate: LocalDate, val startsAt: Instant, val endsAt: Instant)

    /** Compare weekly rules without pretending a finite preview proves an infinite schedule. */
    fun overlapBetween(
        first: Revision,
        second: Revision,
        after: Instant,
        skippedFirst: Set<LocalDate>,
        skippedSecond: Set<LocalDate>,
    ): Pair<Occurrence, Occurrence>? {
        val firstShape =
            WeeklyPatternConflicts.Pattern(
                setOf(first.weekday),
                first.startTime,
                first.durationMinutes,
            )
        val secondShape =
            WeeklyPatternConflicts.Pattern(
                setOf(second.weekday),
                second.startTime,
                second.durationMinutes,
            )
        if (!WeeklyPatternConflicts.overlap(firstShape, secondShape)) return null
        val earliest =
            maxOf(
                after.atZone(zone).toLocalDate().minusDays(Metadata.PermanentSchedule.WEEK_DAYS),
                first.effectiveFrom,
                second.effectiveFrom.minusDays(Metadata.PermanentSchedule.WEEK_DAYS),
            )
        var date =
            earliest.with(TemporalAdjusters.nextOrSame(java.time.DayOfWeek.of(first.weekday)))
        var inspected = 0
        while (first.effectiveUntil == null || date < first.effectiveUntil) {
            if (second.effectiveUntil != null && date >= second.effectiveUntil.plusDays(Metadata.PermanentSchedule.WEEK_DAYS))
                return null
            val start = date.atTime(first.startTime).atZone(zone).toInstant()
            val firstOccurrence =
                Occurrence(date, start, start.plusSeconds(first.durationMinutes.toLong() * Metadata.Recurrence.SECONDS_PER_MINUTE))
            if (date !in skippedFirst && firstOccurrence.endsAt > after) {
                val others = occurrences(second, date.minusDays(Metadata.PermanentSchedule.WEEK_DAYS), date.plusDays(Metadata.PermanentSchedule.WINDOW_PADDING_END))
                val match =
                    others.firstOrNull {
                        it.originalDate !in skippedSecond &&
                            it.endsAt > after &&
                            it.startsAt < firstOccurrence.endsAt &&
                            it.endsAt > firstOccurrence.startsAt
                    }
                if (match != null) return firstOccurrence to match
            }
            if (++inspected >= Metadata.PermanentSchedule.MAX_ITERATIONS)
                throw IllegalStateException("Incomplete permanent schedule conflict check")
            date = date.plusWeeks(1)
        }
        return null
    }

    /**
     * Search a concrete interval against a rule, skipping dates handled by stored exceptions or
     * materialized occurrences. If the bounded search cannot finish, it fails closed.
     */
    fun overlapping(
        revision: Revision,
        from: Instant,
        until: Instant,
        skippedDates: Set<LocalDate>,
    ): Occurrence? {
        require(until > from)
        val earliest =
            from.minusSeconds(revision.durationMinutes.toLong() * Metadata.Recurrence.SECONDS_PER_MINUTE).atZone(zone).toLocalDate()
        var date =
            maxOf(earliest, revision.effectiveFrom)
                .with(TemporalAdjusters.nextOrSame(java.time.DayOfWeek.of(revision.weekday)))
        var inspected = 0
        while (revision.effectiveUntil == null || date < revision.effectiveUntil) {
            val start = date.atTime(revision.startTime).atZone(zone).toInstant()
            if (start >= until) return null
            val end = start.plusSeconds(revision.durationMinutes.toLong() * Metadata.Recurrence.SECONDS_PER_MINUTE)
            if (start < until && end > from && date !in skippedDates)
                return Occurrence(date, start, end)
            if (++inspected >= Metadata.PermanentSchedule.MAX_ITERATIONS)
                throw IllegalStateException("Incomplete permanent schedule conflict check")
            date = date.plusWeeks(1)
        }
        return null
    }

    fun occurrences(revision: Revision, from: LocalDate, until: LocalDate): List<Occurrence> {
        require(until > from)
        // Keep each projection bounded independently of the age of the series.
        // A 93-day instant interval may touch 95 local dates at its boundaries.
        require(java.time.temporal.ChronoUnit.DAYS.between(from, until) <= Metadata.PermanentSchedule.MAX_LOCAL_WINDOW_DAYS)
        val begin = maxOf(from, revision.effectiveFrom)
        val end = revision.effectiveUntil?.let { minOf(until, it) } ?: until
        if (begin >= end) return emptyList()
        var date =
            begin.with(TemporalAdjusters.nextOrSame(java.time.DayOfWeek.of(revision.weekday)))
        val result = mutableListOf<Occurrence>()
        while (date < end) {
            val start = date.atTime(revision.startTime).atZone(zone).toInstant()
            result.add(
                Occurrence(date, start, start.plusSeconds(revision.durationMinutes.toLong() * Metadata.Recurrence.SECONDS_PER_MINUTE))
            )
            date = date.plusWeeks(1)
        }
        return result
    }
}
