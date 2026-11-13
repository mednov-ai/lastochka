package ru.lastochka.scheduling.service

import java.time.Clock
import java.time.LocalDate
import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.conflict
import ru.lastochka.common.error.notFound
import ru.lastochka.common.service.CommandService
import ru.lastochka.identity.service.ConceptStateService
import ru.lastochka.scheduling.dto.SessionInput
import ru.lastochka.scheduling.entity.StudioSession
import ru.lastochka.scheduling.repo.PermanentScheduleRepository
import ru.lastochka.scheduling.repo.RecurrenceRepository
import ru.lastochka.scheduling.repo.StudioSessionRepository

/** Materializes only an already-published and still-current date under the common studio lock. */
@Service
class PermanentOccurrenceService(
    private val commands: CommandService,
    private val concept: ConceptStateService,
    private val permanent: PermanentScheduleRepository,
    private val recurrence: RecurrenceRepository,
    private val repository: StudioSessionRepository,
    private val sessions: SchedulingService,
    private val clock: Clock,
) {
    @Transactional
    fun materialize(seriesId: UUID, originalDate: LocalDate, expectedVersion: Long) = run {
        commands.lockStudio()
        // This code remains fail-closed until the complete permanent-schedule feature enables the mode.
        if (concept.mode() != Metadata.Concept.PERMANENT_SCHEDULE_MODE)
            conflict(Metadata.ErrorCodes.SCHEDULE_UPDATE_REQUIRED)
        if (permanent.permanentRevision(seriesId) != expectedVersion)
            conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        val series = recurrence.series(seriesId) ?: notFound(Metadata.ErrorCodes.NOT_FOUND)
        val versions = permanent.revisionsIn(originalDate.minusDays(Metadata.PermanentSchedule.WEEK_DAYS), originalDate.plusDays(Metadata.PermanentSchedule.WINDOW_PADDING_END))
        if (versions.size > Metadata.PermanentSchedule.MAX_ITEMS) conflict(Metadata.ErrorCodes.CALENDAR_RANGE_TOO_DENSE)
        val matching = versions.filter {
            it.seriesId == seriesId && it.effectiveFrom <= originalDate &&
                (it.effectiveUntil == null || originalDate < it.effectiveUntil) &&
                it.weekday == originalDate.dayOfWeek.value
        }
        if (matching.size != 1) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        val selected = matching.single()
        val rule = PermanentRuleCalendar.Revision(selected.effectiveFrom, selected.effectiveUntil,
            selected.weekday, selected.startTime, selected.durationMinutes)
        val occurrence = PermanentRuleCalendar.occurrences(rule, originalDate, originalDate.plusDays(1)).single()
        if (occurrence.startsAt <= clock.instant()) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        val links = recurrence.membershipsBetween(versions.map { it.seriesId }.distinct(), originalDate.minusDays(Metadata.PermanentSchedule.WEEK_DAYS), originalDate.plusDays(Metadata.PermanentSchedule.WINDOW_PADDING_END))
        if (links.size > Metadata.PermanentSchedule.MAX_ITEMS) conflict(Metadata.ErrorCodes.CALENDAR_RANGE_TOO_DENSE)
        val linkedSessions = sessions.findMany(links.map { it.sessionId })
        val versionsBySeries = versions.groupBy { it.seriesId }
        for (link in links.filter { !it.exception }) {
            val date = requireNotNull(link.originalDate)
            val matchingVersions = versionsBySeries[link.seriesId].orEmpty().filter {
                it.effectiveFrom <= date && (it.effectiveUntil == null || date < it.effectiveUntil) &&
                    it.weekday == date.dayOfWeek.value
            }
            if (matchingVersions.size > 1) conflict(Metadata.ErrorCodes.SCHEDULE_CONFLICT)
            val actual = linkedSessions.getValue(link.sessionId)
            if (matchingVersions.isEmpty() || actual.status == Metadata.Scheduling.CANCELLED) continue
            val relevant = matchingVersions.single()
            val expectedRule = PermanentRuleCalendar.Revision(relevant.effectiveFrom, relevant.effectiveUntil,
                relevant.weekday, relevant.startTime, relevant.durationMinutes)
            val expected = PermanentRuleCalendar.occurrences(expectedRule, date, date.plusDays(1)).single()
            if (actual.status !in setOf(Metadata.Scheduling.OPEN, Metadata.Scheduling.CLOSED) ||
                actual.format != Metadata.Scheduling.GROUP || actual.startsAt != expected.startsAt ||
                actual.endsAt != expected.endsAt || actual.title != relevant.title ||
                actual.capacity != relevant.capacity || actual.ageFrom != relevant.ageFrom ||
                actual.ageTo != relevant.ageTo || actual.ageOpenEnded != relevant.ageOpenEnded)
                conflict(Metadata.ErrorCodes.SCHEDULE_CONFLICT)
        }
        val existing = links.singleOrNull { it.seriesId == seriesId && it.originalDate == originalDate }
        if (existing != null) {
            val session = sessions.find(existing.sessionId)
            if (existing.exception || session.status != Metadata.Scheduling.OPEN ||
                session.format != Metadata.Scheduling.GROUP ||
                session.startsAt != occurrence.startsAt || session.endsAt != occurrence.endsAt ||
                session.title != selected.title || session.capacity != selected.capacity ||
                session.ageFrom != selected.ageFrom || session.ageTo != selected.ageTo ||
                session.ageOpenEnded != selected.ageOpenEnded)
                conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            return@run session
        }
        val candidate = SessionInput(selected.title, Metadata.Scheduling.GROUP, occurrence.startsAt,
            occurrence.endsAt, selected.capacity, selected.ageFrom, selected.ageTo,
            ageOpenEnded = selected.ageOpenEnded)
        sessions.validatePermanentSession(candidate)
        for (other in versions) {
            val skipped = links.filter { it.seriesId == other.seriesId }.mapNotNull { it.originalDate }.toSet() +
                (if (other.seriesId == seriesId) setOf(originalDate) else emptySet())
            val otherRule = PermanentRuleCalendar.Revision(other.effectiveFrom, other.effectiveUntil,
                other.weekday, other.startTime, other.durationMinutes)
            if (PermanentRuleCalendar.overlapping(otherRule, occurrence.startsAt, occurrence.endsAt, skipped) != null)
                conflict(Metadata.ErrorCodes.SCHEDULE_CONFLICT)
        }
        val id = UUID.randomUUID()
        sessions.requireNoSessionOverlap(id, occurrence.startsAt, occurrence.endsAt)
        repository.saveAndFlush(StudioSession(id, candidate.title, candidate.format,
            candidate.startsAt, candidate.endsAt, candidate.capacity, Metadata.Scheduling.OPEN,
            ageFrom = candidate.ageFrom, ageTo = candidate.ageTo))
        recurrence.link(id, series.groupId, seriesId, originalDate)
        sessions.find(id).also { commands.audit(id, null, Metadata.PermanentSchedule.OCCURRENCE_MATERIALIZED, null, it) }
    }
}
