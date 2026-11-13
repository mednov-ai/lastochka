package ru.lastochka.scheduling.service

import java.time.Instant
import java.time.ZoneId
import java.util.UUID
import org.springframework.stereotype.Service
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.conflict
import ru.lastochka.scheduling.repo.PermanentScheduleRepository
import ru.lastochka.scheduling.repo.RecurrenceRepository

/** Protects legacy session and finite-series commands against calculated occurrences. */
@Service
class PermanentScheduleConflicts(
    private val permanent: PermanentScheduleRepository,
    private val recurrence: RecurrenceRepository,
) {
    fun overlaps(from: Instant, until: Instant, editedSessionId: UUID? = null): Boolean =
        conflicts(listOf(from to until), editedSessionId).isNotEmpty()

    fun conflicts(intervals: Collection<Pair<Instant, Instant>>, editedSessionId: UUID? = null): Set<Pair<Instant, Instant>> {
        if (intervals.isEmpty()) return emptySet()
        require(intervals.all { it.second > it.first })
        val zone = ZoneId.of(Metadata.Time.STUDIO_ZONE)
        val first = intervals.minOf { it.first }.atZone(zone).toLocalDate().minusDays(Metadata.PermanentSchedule.WEEK_DAYS)
        val last = intervals.maxOf { it.second }.atZone(zone).toLocalDate().plusDays(1)
        val revisions = permanent.revisionsIn(first, last)
        if (revisions.size > Metadata.PermanentSchedule.MAX_ITEMS || intervals.size.toLong() * revisions.size > 50_000)
            conflict(Metadata.ErrorCodes.CALENDAR_RANGE_TOO_DENSE)
        val links = recurrence.membershipsBetween(revisions.map { it.seriesId }.distinct(), first, last)
        if (links.size > Metadata.PermanentSchedule.MAX_ITEMS) conflict(Metadata.ErrorCodes.CALENDAR_RANGE_TOO_DENSE)
        // An exception frees its original date. For ordinary materialized dates we
        // retain the rule as a conservative guard, except when editing that same
        // session; the normal session-overlap check covers its concrete interval.
        val replaced = links.filter { it.exception || it.sessionId == editedSessionId }
            .groupBy { it.seriesId }.mapValues { (_, items) ->
            items.mapNotNull { it.originalDate }.toSet()
        }
        return intervals.filter { (from, until) ->
            revisions.any { item ->
                val rule = PermanentRuleCalendar.Revision(item.effectiveFrom, item.effectiveUntil,
                    item.weekday, item.startTime, item.durationMinutes)
                PermanentRuleCalendar.overlapping(rule, from, until, replaced[item.seriesId].orEmpty()) != null
            }
        }.toSet()
    }
}
