package ru.lastochka.scheduling.service

import ru.lastochka.common.Metadata
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime

/** Pure conflict evaluation; persistence and publication must repeat it under the studio lock. */
internal object PermanentSchedulePlan {
    data class Slot(val weekday: Int, val time: LocalTime, val durationMinutes: Int)

    data class KnownRule(
        val revision: PermanentRuleCalendar.Revision,
        val replacedDates: Set<LocalDate>,
    )

    data class BusyInterval(val start: Instant, val end: Instant)

    data class Conflict(val slot: Int, val source: String, val originalDate: LocalDate)

    data class Plan(
        val samples: List<List<PermanentRuleCalendar.Occurrence>>,
        val conflicts: List<Conflict>,
    )

    fun preview(
        start: LocalDate,
        slots: List<Slot>,
        now: Instant,
        rules: List<KnownRule>,
        busy: List<BusyInterval>,
        drafts: List<BusyInterval> = emptyList(),
        skippedProposed: Set<LocalDate> = emptySet(),
    ): Plan {
        require(slots.isNotEmpty() && slots.size <= Metadata.PermanentSchedule.MAX_SLOTS)
        require(rules.size <= Metadata.PermanentSchedule.MAX_ITEMS && busy.size <= Metadata.PermanentSchedule.MAX_ITEMS && drafts.size <= Metadata.PermanentSchedule.MAX_ITEMS)
        check(slots.size.toLong() * (rules.size + busy.size + drafts.size) <= 50_000) {
            "Permanent schedule conflict check exceeds resource limit"
        }
        val revisions =
            slots.map {
                PermanentRuleCalendar.Revision(start, null, it.weekday, it.time, it.durationMinutes)
            }
        val conflicts = mutableListOf<Conflict>()
        revisions.forEachIndexed { index, proposed ->
            revisions.take(index).forEach { other ->
                PermanentRuleCalendar.overlapBetween(proposed, other, now, skippedProposed, skippedProposed)
                    ?.let { conflicts.add(Conflict(index, Metadata.PermanentSchedule.CONFLICT_PLAN, it.first.originalDate)) }
            }
            rules.forEach { other ->
                PermanentRuleCalendar.overlapBetween(
                        proposed,
                        other.revision,
                        now,
                        skippedProposed,
                        other.replacedDates,
                    )
                    ?.let { conflicts.add(Conflict(index, Metadata.PermanentSchedule.CONFLICT_RULE, it.first.originalDate)) }
            }
            busy.forEach { interval ->
                require(interval.end > interval.start)
                if (interval.end > now) {
                    PermanentRuleCalendar.overlapping(
                            proposed,
                            maxOf(interval.start, now),
                            interval.end,
                            skippedProposed,
                        )
                        ?.let { conflicts.add(Conflict(index, Metadata.PermanentSchedule.CONFLICT_SESSION, it.originalDate)) }
                }
            }
            drafts.forEach { interval ->
                require(interval.end > interval.start)
                if (interval.end > now) {
                    PermanentRuleCalendar.overlapping(proposed, maxOf(interval.start, now), interval.end, skippedProposed)
                        ?.let { conflicts.add(Conflict(index, Metadata.Concept.DRAFT, it.originalDate)) }
                }
            }
        }
        return Plan(
            revisions.map { PermanentRuleCalendar.occurrences(it, start, start.plusDays(Metadata.PermanentSchedule.PREVIEW_DAYS))
                .filter { occurrence -> occurrence.startsAt > now && occurrence.originalDate !in skippedProposed } },
            conflicts,
        )
    }
}
