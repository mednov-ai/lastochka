package ru.lastochka.scheduling.service

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import ru.lastochka.common.Metadata
import ru.lastochka.scheduling.dto.SessionMembership
import ru.lastochka.scheduling.dto.SessionView
import ru.lastochka.scheduling.dto.ScheduleRuleReference

/** Read-only merge. A calculated occurrence is never represented by a fabricated UUID. */
internal object PermanentScheduleProjection {
    data class Rule(
        val seriesId: UUID,
        val seriesVersion: Long,
        val revision: PermanentRuleCalendar.Revision,
        val title: String,
        val capacity: Int,
        val ageFrom: Int,
        val ageTo: Int?,
        val ageOpenEnded: Boolean,
    )

    sealed interface Item {
        val startsAt: Instant
        val sortKey: String
    }

    data class Real(val session: SessionView, val origin: ScheduleRuleReference?) : Item {
        override val startsAt: Instant
            get() = session.startsAt

        override val sortKey: String
            get() = "0:${session.id}"
    }

    data class Calculated(
        val seriesId: UUID,
        val originalDate: LocalDate,
        val seriesVersion: Long,
        override val startsAt: Instant,
        val endsAt: Instant,
        val title: String,
        val capacity: Int,
        val ageFrom: Int,
        val ageTo: Int?,
        val ageOpenEnded: Boolean,
    ) : Item {
        override val sortKey: String
            get() = "1:$seriesId:$originalDate"
    }

    private fun matches(session: SessionView, rule: Rule, occurrence: PermanentRuleCalendar.Occurrence) =
        session.format == Metadata.Scheduling.GROUP &&
            session.startsAt == occurrence.startsAt && session.endsAt == occurrence.endsAt &&
            session.title == rule.title && session.capacity == rule.capacity &&
            session.ageFrom == rule.ageFrom && session.ageTo == rule.ageTo &&
            session.ageOpenEnded == rule.ageOpenEnded

    fun calculate(
        from: Instant,
        to: Instant,
        now: Instant,
        selectable: Boolean,
        rules: List<Rule>,
        memberships: List<SessionMembership>,
        sessions: List<SessionView>,
        linkedSessions: Map<UUID, SessionView>,
        includePastCalculated: Boolean = false,
    ): List<Item> {
        require(to > from && Duration.between(from, to) <= Duration.ofDays(Metadata.SchedulingLimits.MAX_SEARCH_DAYS))
        check(rules.size <= Metadata.PermanentSchedule.MAX_ITEMS && memberships.size <= Metadata.PermanentSchedule.MAX_ITEMS && sessions.size <= Metadata.PermanentSchedule.MAX_ITEMS)
        val links =
            memberships
                .filter { it.seriesId != null }
                .map { it.seriesId!! to requireNotNull(it.originalDate) }
        check(links.size == links.toSet().size) { "Duplicate permanent occurrence links" }
        val existing = links.toSet()
        val bySession = memberships.associateBy { it.sessionId }
        check(bySession.size == memberships.size) { "Duplicate session membership" }
        val zone = ZoneId.of(Metadata.Time.STUDIO_ZONE)
        val first = from.atZone(zone).toLocalDate()
        val until = to.atZone(zone).toLocalDate().plusDays(1)
        val virtualKeys = mutableSetOf<Pair<UUID, LocalDate>>()
        val expected = mutableMapOf<Pair<UUID, LocalDate>, Pair<Rule, PermanentRuleCalendar.Occurrence>>()
        val projected = mutableListOf<Item>()
        for (rule in rules) {
            for (occurrence in PermanentRuleCalendar.occurrences(rule.revision, first, until)) {
                val key = rule.seriesId to occurrence.originalDate
                check(virtualKeys.add(key)) { "Overlapping permanent rule revisions" }
                expected[key] = rule to occurrence
                if (
                    key in existing ||
                        occurrence.startsAt < from ||
                        occurrence.startsAt >= to ||
                        (!includePastCalculated && occurrence.startsAt <= now)
                )
                    continue
                projected.add(
                    Calculated(
                        rule.seriesId,
                        occurrence.originalDate,
                        rule.seriesVersion,
                        occurrence.startsAt,
                        occurrence.endsAt,
                        rule.title,
                        rule.capacity,
                        rule.ageFrom,
                        rule.ageTo,
                        rule.ageOpenEnded,
                    )
                )
            }
        }
        for (link in memberships.filter { !it.exception && it.seriesId != null }) {
            val entry = expected[link.seriesId!! to requireNotNull(link.originalDate)] ?: continue
            val linked = requireNotNull(linkedSessions[link.sessionId]) { "Missing linked session" }
            if (linked.status != Metadata.Scheduling.CANCELLED) {
                check(linked.status in setOf(Metadata.Scheduling.OPEN, Metadata.Scheduling.CLOSED) &&
                    matches(linked, entry.first, entry.second)) { "Inconsistent permanent occurrence" }
            }
        }
        for (session in sessions) {
            if (session.startsAt < from || session.startsAt >= to || session.startsAt <= now)
                continue
            if (
                session.status != Metadata.Scheduling.OPEN &&
                    (selectable || session.status != Metadata.Scheduling.CLOSED)
            )
                continue
            val link = bySession[session.id]?.takeIf { it.seriesId != null }
            val expectedEntry = link?.let { expected[it.seriesId!! to requireNotNull(it.originalDate)] }
            val origin = if (link != null && !link.exception && expectedEntry != null) {
                val (rule, occurrence) = expectedEntry
                if (session.status == Metadata.Scheduling.OPEN && matches(session, rule, occurrence))
                    ScheduleRuleReference(1, rule.seriesId, occurrence.originalDate, rule.seriesVersion)
                else null
            } else null
            projected.add(Real(session, origin))
        }
        check(projected.size <= Metadata.PermanentSchedule.MAX_ITEMS) { "Permanent schedule result is too dense" }
        return projected.sortedWith(compareBy<Item> { it.startsAt }.thenBy { it.sortKey })
    }
}
