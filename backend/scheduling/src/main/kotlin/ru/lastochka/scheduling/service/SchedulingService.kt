package ru.lastochka.scheduling.service

import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.web.server.ResponseStatusException
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.FieldValidationException
import ru.lastochka.common.error.badRequest
import ru.lastochka.common.error.conflict
import ru.lastochka.common.error.notFound
import ru.lastochka.common.service.CommandService
import ru.lastochka.scheduling.dto.*
import ru.lastochka.scheduling.entity.StudioSession
import ru.lastochka.scheduling.repo.SessionQueryRepository
import ru.lastochka.scheduling.repo.StudioSessionRepository

@Service
class SchedulingService(
    private val repo: StudioSessionRepository,
    private val storage: SessionQueryRepository,
    private val commands: CommandService,
    private val clock: Clock,
    private val recurrence: ru.lastochka.scheduling.repo.RecurrenceRepository,
    private val permanentConflicts: PermanentScheduleConflicts,
    private val permanent: ru.lastochka.scheduling.repo.PermanentScheduleRepository,
    private val ageDirections: ru.lastochka.scheduling.repo.AgeDirectionRepository,
    private val concept: ru.lastochka.identity.service.ConceptStateService,
) {
    fun find(id: UUID): SessionView =
        view(
            repo.findById(id).orElseThrow {
                ResponseStatusException(HttpStatus.NOT_FOUND, Metadata.ErrorCodes.NOT_FOUND)
            }
        )

    fun findMany(ids: Collection<UUID>): Map<UUID, SessionView> {
        if (ids.isEmpty()) return emptyMap()
        val sessions = repo.findAllById(ids).associateBy { it.id }
        return ids.associateWith { id ->
            view(sessions[id] ?: notFound(Metadata.ErrorCodes.NOT_FOUND))
        }
    }

    fun findPublishedSession(id: UUID): SessionView {
        val session = find(id)
        if (session.status !in setOf(Metadata.Scheduling.OPEN, Metadata.Scheduling.CLOSED))
            notFound(Metadata.ErrorCodes.NOT_FOUND)
        return session
    }

    @Transactional(
        readOnly = true,
        isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ,
    )
    fun calendar(from: Instant, to: Instant): CalendarView {
        if (
            to <= from ||
                Duration.between(from, to) >
                    Duration.ofDays(Metadata.SchedulingLimits.MAX_CALENDAR_DAYS)
        )
            badRequest(Metadata.ErrorCodes.INVALID_RANGE)
        val ids = storage.calendarIds(from, to)
        if (ids.size > Metadata.SchedulingLimits.MAX_CALENDAR_SESSIONS)
            conflict(Metadata.ErrorCodes.CALENDAR_RANGE_TOO_DENSE)
        return CalendarView(findMany(ids.filterNotNull()).values.toList(), from, to)
    }

    private fun view(session: StudioSession) =
        SessionView(
            session.id,
            session.title,
            session.format,
            session.startsAt,
            session.endsAt,
            session.capacity,
            session.status,
            session.version,
            ageFrom = session.ageFrom,
            ageTo = session.ageTo,
            ageOpenEnded = session.ageFrom != null && session.ageTo == null,
        )

    fun list(
        from: Instant,
        to: Instant,
        page: Int,
        size: Int,
        admin: Boolean,
        selectable: Boolean = false,
    ): SessionPage {
        if (
            page < 0 ||
                size !in 1..Metadata.Limits.PAGE_SIZE_MAX ||
                to <= from ||
                Duration.between(from, to) >
                    Duration.ofDays(Metadata.SchedulingLimits.MAX_SEARCH_DAYS)
        )
            badRequest(Metadata.ErrorCodes.INVALID_RANGE)
        val (ids, total) = storage.findPage(from, to, page, size, admin, selectable)
        return SessionPage(findMany(ids.filterNotNull()).values.toList(), page, size, total)
    }

    fun validateSession(input: SessionInput) = validateSession(input, clock.instant())

    fun validateSession(input: SessionInput, now: Instant) = validateSessionFields(input, now)

    // This path is only used by version-gated permanent rules, whose age directory
    // may include adults. Existing public/admin commands retain their old contract.
    fun validatePermanentSession(input: SessionInput) = validateSessionFields(input, clock.instant(), Metadata.PermanentSchedule.MAX_ADULT_AGE)

    // Recurring plans apply their own action-specific time eligibility.
    fun validateSeriesSession(input: SessionInput) = validateSessionFields(input, null)

    // An individual correction can describe an already started session.
    fun validateExistingSession(input: SessionInput) = validateSessionFields(input, null)

    fun validateExistingSession(id: UUID, input: SessionInput) {
        val existing = repo.findById(id).orElse(null)
        val adult = (existing?.ageFrom ?: 0) > Metadata.Concept.MAX_AGE || (existing?.ageTo ?: 0) > Metadata.Concept.MAX_AGE
        validateSessionFields(input, null, if (permanent.isPermanentSession(id) || adult) Metadata.PermanentSchedule.MAX_ADULT_AGE else Metadata.Concept.MAX_AGE)
    }

    private fun validateSessionFields(input: SessionInput, now: Instant?, maxAge: Int = Metadata.Concept.MAX_AGE) {
        val errors = linkedMapOf<String, String>()
        if (input.title.isBlank() || input.title.length > Metadata.Limits.MAX_NAME_LENGTH)
            errors["title"] = Metadata.Editor.FIELD_TITLE
        if (now != null && input.startsAt <= now) errors["startsAt"] = Metadata.Editor.FIELD_START
        if (input.endsAt <= input.startsAt) errors["endsAt"] = Metadata.Editor.FIELD_END
        if (
            input.capacity <= 0 ||
                input.format == Metadata.Scheduling.INDIVIDUAL && input.capacity != 1
        )
            errors["capacity"] = Metadata.Editor.FIELD_CAPACITY
        val validAge =
            when {
                input.ageFrom == null -> input.ageTo == null && input.ageOpenEnded != true
                input.ageFrom !in 0..maxAge -> false
                input.ageOpenEnded == true -> input.ageTo == null
                else ->
                    input.ageTo != null && input.ageTo in input.ageFrom..maxAge
            }
        if (!validAge) {
            errors["ageFrom"] = Metadata.Editor.FIELD_AGE_RANGE
            errors["ageTo"] = Metadata.Editor.FIELD_AGE_RANGE
        }
        if (input.format !in setOf(Metadata.Scheduling.GROUP, Metadata.Scheduling.INDIVIDUAL))
            badRequest(Metadata.ErrorCodes.VALIDATION_ERROR)
        if (errors.isNotEmpty()) throw FieldValidationException(errors)
    }

    fun requireNoSessionOverlap(id: UUID, from: Instant, to: Instant) {
        val n = storage.countOverlaps(id, from, to)
        if (n > 0) conflict(Metadata.ErrorCodes.SCHEDULE_CONFLICT)
    }

    fun permanentConflicts(inputs: Collection<SessionInput>) =
        permanentConflicts.conflicts(inputs.map { it.startsAt to it.endsAt })

    @Transactional
    fun create(actor: UUID, key: String, input: SessionInput) =
        commands.execute(
            actor,
            Metadata.Commands.SESSION_CREATE,
            key,
            input,
            SessionView::class.java,
        ) {
            val selected = if (input.ageDirectionId != null || input.ageDirectionVersion != null) {
                if (input.format != Metadata.Scheduling.GROUP || input.ageDirectionId == null || input.ageDirectionVersion == null)
                    throw FieldValidationException(mapOf("ageDirectionId" to Metadata.ErrorCodes.FIELD_INVALID))
                val direction = ageDirections.findById(input.ageDirectionId).orElse(null)
                    ?: notFound(Metadata.ErrorCodes.NOT_FOUND)
                if (!direction.active || direction.version != input.ageDirectionVersion)
                    conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
                input.copy(title = direction.title, ageFrom = direction.ageFrom, ageTo = direction.ageTo,
                    ageOpenEnded = direction.ageOpenEnded)
            } else input
            if (input.ageDirectionId != null) validatePermanentSession(selected) else validateSession(selected)
            if ((selected.ageFrom ?: 0) > Metadata.Concept.MAX_AGE || (selected.ageTo ?: 0) > Metadata.Concept.MAX_AGE) {
                val mode = concept.mode()
                if (mode == Metadata.Concept.MODE && concept.transition(mode, Metadata.Concept.PERMANENT_SCHEDULE_MODE) != 1)
                    conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
                if (mode !in setOf(Metadata.Concept.MODE, Metadata.Concept.PERMANENT_SCHEDULE_MODE))
                    conflict(Metadata.ErrorCodes.SCHEDULE_UPDATE_REQUIRED)
            }
            val saved =
                repo.saveAndFlush(
                    StudioSession(
                        title = selected.title.trim(),
                        format = selected.format,
                        startsAt = selected.startsAt,
                        endsAt = selected.endsAt,
                        capacity = selected.capacity,
                        ageFrom = selected.ageFrom,
                        ageTo = selected.ageTo,
                    )
                )
            input.groupId?.let { group ->
                if (input.format != Metadata.Scheduling.GROUP || recurrence.group(group) == null)
                    badRequest(Metadata.ErrorCodes.VALIDATION_ERROR)
                recurrence.link(saved.id, group)
            }
            view(saved).also {
                commands.audit(saved.id, actor, Metadata.Scheduling.SESSION_CREATED, null, it)
            }
        }

    @Transactional
    fun update(actor: UUID, id: UUID, key: String, input: SessionUpdate) =
        commands.execute(
            actor,
            "${Metadata.Commands.SESSION_UPDATE_PREFIX}$id",
            key,
            input,
            SessionView::class.java,
        ) {
            val session =
                repo.findById(id).orElseThrow {
                    ResponseStatusException(HttpStatus.NOT_FOUND, Metadata.ErrorCodes.NOT_FOUND)
                }
            val before = view(session)
            if (session.version != input.expectedVersion)
                conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            if (session.status == Metadata.Scheduling.CANCELLED)
                conflict(Metadata.ErrorCodes.SESSION_UNAVAILABLE)
            requireAgeCapability(before, input.session)
            validateExistingSession(id, input.session)
            if (session.status != Metadata.Scheduling.DRAFT)
                requireNoSessionOverlap(id, input.session.startsAt, input.session.endsAt)
            if (session.status != Metadata.Scheduling.DRAFT &&
                permanentConflicts.overlaps(input.session.startsAt, input.session.endsAt, id))
                conflict(Metadata.ErrorCodes.SCHEDULE_CONFLICT)

            session.title = input.session.title.trim()
            session.format = input.session.format
            session.startsAt = input.session.startsAt
            session.endsAt = input.session.endsAt
            session.capacity = input.session.capacity
            if (
                input.session.replaceAgeRange ||
                    input.session.ageFrom != null ||
                    input.session.ageTo != null
            ) {
                session.ageFrom = input.session.ageFrom
                session.ageTo = input.session.ageTo
            }
            maintainGroup(session, input.session)
            recurrence.touch(id, true)
            repo.flush()
            val after = view(session)
            commands.audit(id, actor, Metadata.Scheduling.SESSION_UPDATED, before, after)

            after
        }

    @Transactional
    fun applySessionAction(actor: UUID, id: UUID, key: String, input: SessionAction) =
        commands.execute(
            actor,
            "${Metadata.Commands.SESSION_ACTION_PREFIX}$id",
            key,
            input,
            SessionView::class.java,
        ) {
            val session =
                repo.findById(id).orElseThrow {
                    ResponseStatusException(HttpStatus.NOT_FOUND, Metadata.ErrorCodes.NOT_FOUND)
                }
            val before = view(session)
            if (session.version != input.expectedVersion)
                conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            if (
                session.status == Metadata.Scheduling.CANCELLED ||
                    (session.startsAt <= clock.instant() &&
                        !(session.status == Metadata.Scheduling.DRAFT &&
                            input.action == Metadata.Scheduling.PUBLISH))
            )
                conflict(Metadata.ErrorCodes.SESSION_UNAVAILABLE)
            session.status =
                when (input.action) {
                    Metadata.Scheduling.PUBLISH,
                    Metadata.Scheduling.REOPEN -> {
                        if (
                            input.action == Metadata.Scheduling.PUBLISH &&
                                session.status != Metadata.Scheduling.DRAFT ||
                                input.action == Metadata.Scheduling.REOPEN &&
                                    session.status != Metadata.Scheduling.CLOSED
                        )
                            conflict(Metadata.ErrorCodes.SESSION_UNAVAILABLE)
                        requireNoSessionOverlap(id, session.startsAt, session.endsAt)
                        if (permanentConflicts.overlaps(session.startsAt, session.endsAt, id))
                            conflict(Metadata.ErrorCodes.SCHEDULE_CONFLICT)
                        Metadata.Scheduling.OPEN
                    }
                    Metadata.Scheduling.CLOSE -> {
                        if (session.status != Metadata.Scheduling.OPEN)
                            conflict(Metadata.ErrorCodes.SESSION_UNAVAILABLE)
                        Metadata.Scheduling.CLOSED
                    }
                    Metadata.Scheduling.CANCEL -> {
                        if (input.reason.isNullOrBlank())
                            badRequest(Metadata.ErrorCodes.REASON_REQUIRED)
                        Metadata.Scheduling.CANCELLED
                    }
                    else -> badRequest(Metadata.ErrorCodes.VALIDATION_ERROR)
                }
            recurrence.touch(id, true)
            repo.flush()
            val changed = view(session)

            val after = view(session)
            commands.audit(
                id,
                actor,
                when (input.action) {
                    Metadata.Scheduling.PUBLISH -> Metadata.Commands.SESSION_PUBLISH
                    Metadata.Scheduling.REOPEN -> Metadata.Commands.SESSION_REOPEN
                    Metadata.Scheduling.CLOSE -> Metadata.Commands.SESSION_CLOSE
                    else -> Metadata.Commands.SESSION_CANCEL
                },
                before,
                after,
                input.reason,
            )
            after
        }

    private fun maintainGroup(session: StudioSession, input: SessionInput) {
        val link = recurrence.memberships().firstOrNull { it.sessionId == session.id }
        if (link != null && session.format != Metadata.Scheduling.GROUP)
            conflict(Metadata.ErrorCodes.VALIDATION_ERROR)
        if (input.groupId != null || input.replaceGroup) {
            if (link?.seriesId != null && input.groupId != link.groupId)
                conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            if (input.groupId == null) recurrence.unlink(session.id)
            else {
                if (
                    session.format != Metadata.Scheduling.GROUP ||
                        recurrence.group(input.groupId) == null
                )
                    badRequest(Metadata.ErrorCodes.VALIDATION_ERROR)
                recurrence.link(session.id, input.groupId)
            }
        }
    }

    // A legacy client cannot distinguish open-ended ages from an incomplete range and must not
    // overwrite one, even if it silently drops both age fields from its request.
    fun requireAgeCapability(current: SessionView, input: SessionInput) {
        if (current.ageOpenEnded && input.ageOpenEnded == null)
            conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
    }
}
