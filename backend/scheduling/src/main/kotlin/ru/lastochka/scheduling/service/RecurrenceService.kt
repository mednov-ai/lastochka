package ru.lastochka.scheduling.service

import java.security.MessageDigest
import java.time.Clock
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters
import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.*
import ru.lastochka.common.service.CommandService
import ru.lastochka.scheduling.dto.*
import ru.lastochka.scheduling.entity.StudioSession
import ru.lastochka.scheduling.repo.RecurrenceRepository
import ru.lastochka.scheduling.repo.StudioSessionRepository
import tools.jackson.databind.json.JsonMapper

// Keep digests compatible with plans computed before conflictCodes was added.
private data class LegacyPlanRow(
    val originalDate: LocalDate,
    val action: String,
    val sessionId: UUID?,
    val version: Long?,
    val before: SessionView?,
    val proposed: SessionInput?,
    val conflict: String?,
    val exception: Boolean,
) {
    constructor(
        row: SeriesPlanRow
    ) : this(
        row.originalDate,
        row.action,
        row.sessionId,
        row.version,
        row.before,
        row.proposed,
        row.conflict,
        row.exception,
    )
}

@Service
class RecurrenceService(
    private val storage: RecurrenceRepository,
    private val repository: StudioSessionRepository,
    private val sessions: SchedulingService,
    private val commands: CommandService,
    private val clock: Clock,
    private val json: JsonMapper,
    private val messages: MessageProvider,
) {
    private val zone = ZoneId.of(Metadata.Time.STUDIO_ZONE)

    fun groups() = ScheduleGroupList(storage.groups())

    fun list() = SessionSeriesList(storage.series())

    fun read(id: UUID) = storage.series(id) ?: notFound(Metadata.ErrorCodes.NOT_FOUND)

    fun group(id: UUID) = storage.group(id) ?: notFound(Metadata.ErrorCodes.NOT_FOUND)

    fun history(id: UUID, page: Int): RecurrenceHistory {
        if (page < 0) badRequest(Metadata.ErrorCodes.INVALID_PAGE)
        if (storage.series(id) == null && storage.group(id) == null)
            notFound(Metadata.ErrorCodes.NOT_FOUND)
        return storage.history(id, page)
    }

    @Transactional
    fun saveGroup(
        actor: UUID,
        id: UUID?,
        key: String,
        input: ScheduleGroupUpdate,
    ): ScheduleGroupView =
        commands.execute(actor, "group-save:$id", key, input, ScheduleGroupView::class.java) {
            val existing = id?.let { group(it) }
            if ((existing?.version ?: 0) != input.expectedVersion)
                conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            val p = input.parameters.copy(name = input.parameters.name.trim())
            validateGroup(p)
            val target = id ?: UUID.randomUUID()
            storage.saveGroup(target, p, id == null)
            storage.audit(
                target,
                actor,
                Metadata.Recurrence.GROUP_SAVED,
                UUID.randomUUID(),
                group = p,
            )
            group(target)
        }

    private fun validateGroup(p: ScheduleGroupInput, now: Instant = clock.instant()) {
        if (p.name.isBlank() || p.name.length > Metadata.Limits.MAX_NAME_LENGTH)
            throw FieldValidationException(mapOf("name" to Metadata.Editor.FIELD_TITLE))
        sessions.validateSession(
            SessionInput(
                p.name,
                Metadata.Scheduling.GROUP,
                now.plusSeconds(Metadata.Recurrence.VALIDATION_DELAY_SECONDS),
                now.plusSeconds(Metadata.Recurrence.VALIDATION_END_SECONDS),
                p.capacity,
                p.ageFrom,
                p.ageTo,
            ),
            now,
        )
    }

    fun expand(rule: SeriesRule): List<LocalDate> = expand(rule, clock.instant())

    private fun expand(rule: SeriesRule, now: Instant): List<LocalDate> {
        val days = ChronoUnit.DAYS.between(rule.startDate, rule.endDate) + 1
        if (
            days !in 1..Metadata.Recurrence.MAX_DAYS ||
                rule.weekdays.isEmpty() ||
                rule.weekdays.any { it !in 1..Metadata.Recurrence.LAST_WEEKDAY } ||
                rule.weekdays.distinct().size != rule.weekdays.size ||
                rule.durationMinutes <= 0
        )
            throw FieldValidationException(
                mapOf(
                    "startDate" to Metadata.Recurrence.INVALID_RULE,
                    "weekdays" to Metadata.Recurrence.INVALID_RULE,
                )
            )
        validateGroup(ScheduleGroupInput(rule.title, rule.capacity, rule.ageFrom, rule.ageTo), now)
        val dates =
            (0 until days)
                .map { rule.startDate.plusDays(it) }
                .filter { it.dayOfWeek.value in rule.weekdays }
        if (dates.isEmpty() || dates.size > Metadata.Recurrence.MAX_OCCURRENCES)
            badRequest(Metadata.Recurrence.INVALID_RULE)
        return dates
    }

    private fun parameters(rule: SeriesRule, date: LocalDate): SessionInput {
        val start = date.atTime(rule.startTime).atZone(zone).toInstant()
        return SessionInput(
            rule.title.trim(),
            Metadata.Scheduling.GROUP,
            start,
            start.plusSeconds(
                rule.durationMinutes.toLong() * Metadata.Recurrence.SECONDS_PER_MINUTE
            ),
            rule.capacity,
            rule.ageFrom,
            rule.ageTo,
            true,
        )
    }

    @Transactional(
        readOnly = true,
        isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ,
    )
    fun preview(id: UUID?, input: SeriesDraftInput): SeriesPlan {
        group(input.groupId)
        return plan(id, input)
    }

    @Transactional(
        readOnly = true,
        isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ,
    )
    fun previewNewGroup(input: NewGroupSeriesInput): SeriesPlan =
        plan(
            null,
            SeriesDraftInput(
                UUID.fromString(Metadata.Recurrence.PREVIEW_GROUP_ID),
                rule = input.rule,
            ),
        )

    private fun plan(id: UUID?, input: SeriesDraftInput): SeriesPlan {
        val now = clock.instant()
        val weekStart =
            now.atZone(zone)
                .toLocalDate()
                .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                .atStartOfDay(zone)
                .toInstant()
        val state = id?.let { read(it) }
        if (
            state != null &&
                (state.groupId != input.groupId ||
                    state.version != input.expectedVersion ||
                    state.draftVersion != input.expectedDraftVersion)
        )
            conflict(Metadata.Recurrence.PLAN_STALE)
        val dates = expand(input.rule, now)
        val links = storage.memberships().filter { it.seriesId == id && id != null }
        val allDates = (links.mapNotNull { it.originalDate } + dates).distinct().sorted()
        if (
            allDates.size > Metadata.Recurrence.MAX_OCCURRENCES ||
                ChronoUnit.DAYS.between(allDates.first(), allDates.last()) + 1 >
                    Metadata.Recurrence.MAX_DAYS
        )
            badRequest(Metadata.Recurrence.INVALID_RULE)
        val old = sessions.findMany(links.map { it.sessionId })
        val byDate = links.associateBy { it.originalDate!! }
        val drafts = storage.draftIds(links.map { it.sessionId })
        val desired = if (input.cancelFollowing) emptySet() else dates.toSet()
        var rows = allDates.map { date ->
            val link = byDate[date]
            val before = link?.let { old.getValue(it.sessionId) }
            val keep =
                before != null &&
                    (date < input.rule.startDate ||
                        link.exception ||
                        before.status == Metadata.Scheduling.CANCELLED ||
                        before.startsAt <= now)
            val p = if (date in desired) parameters(input.rule, date) else null
            val same =
                before != null &&
                    p != null &&
                    before.title == p.title &&
                    before.startsAt == p.startsAt &&
                    before.endsAt == p.endsAt &&
                    before.capacity == p.capacity &&
                    before.ageFrom == p.ageFrom &&
                    before.ageTo == p.ageTo
            val action =
                when {
                    keep || same -> Metadata.Recurrence.KEEP
                    before == null && p != null -> Metadata.Recurrence.CREATE
                    before != null && p == null -> Metadata.Recurrence.CANCEL
                    before != null -> Metadata.Recurrence.CHANGE
                    else -> Metadata.Recurrence.KEEP
                }
            val conflict =
                if (action != Metadata.Recurrence.KEEP && before?.id in drafts)
                    messages.text(Metadata.Recurrence.PARAMETER_CONFLICT)
                else null
            SeriesPlanRow(
                date,
                action,
                before?.id,
                before?.version,
                before,
                if (action in setOf(Metadata.Recurrence.CREATE, Metadata.Recurrence.CHANGE)) p
                else null,
                conflict,
                link?.exception ?: false,
            )
        }
        val proposed = rows.mapNotNull { it.proposed }
        // Temporal eligibility is classified per action below; validate all other fields for every
        // row.
        proposed.forEach { sessions.validateSeriesSession(it) }
        val changed =
            rows
                .filter { it.action != Metadata.Recurrence.KEEP }
                .mapNotNull { it.sessionId }
                .toSet()
        val busy =
            if (proposed.isEmpty()) emptyList()
            else
                sessions
                    .findMany(
                        storage.busyIds(
                            proposed.minOf { it.startsAt },
                            proposed.maxOf { it.endsAt },
                        )
                    )
                    .values
                    .filter { it.id !in changed }
        rows = rows.map { row ->
            val p = row.proposed
            val overlap =
                p != null &&
                    (busy.any { it.startsAt < p.endsAt && it.endsAt > p.startsAt } ||
                        rows.any {
                            it !== row &&
                                it.proposed != null &&
                                it.proposed.startsAt < p.endsAt &&
                                it.proposed.endsAt > p.startsAt
                        })
            val codes = buildList {
                if (p != null && row.action == Metadata.Recurrence.CREATE && p.startsAt < weekStart)
                    add(Metadata.Recurrence.BEFORE_CURRENT_WEEK)
                if (p != null && row.action == Metadata.Recurrence.CHANGE && p.startsAt <= now)
                    add(Metadata.Editor.FIELD_START)
                if (overlap) add(Metadata.Recurrence.RESOURCE_CONFLICT)
                if (row.conflict != null) add(Metadata.Recurrence.PARAMETER_CONFLICT)
            }
            row.copy(
                conflict = codes.firstOrNull()?.let { messages.text(it) },
                conflictCodes = codes.takeIf { it.isNotEmpty() },
            )
        }
        val digest =
            MessageDigest.getInstance(Metadata.Protocol.SHA256)
                .digest(
                    json.writeValueAsBytes(
                        listOf(
                            input,
                            state?.version,
                            state?.draftVersion,
                            rows.map { LegacyPlanRow(it) },
                            drafts.sortedBy { it.toString() },
                        )
                    )
                )
                .joinToString("") { "%02x".format(it) }
        val cancellations = rows.count { it.action == Metadata.Recurrence.CANCEL }
        return SeriesPlan(
            id,
            input.groupId,
            digest,
            rows,
            rows.size,
            rows.count { it.action == Metadata.Recurrence.CREATE },
            rows.count { it.action == Metadata.Recurrence.CHANGE },
            cancellations,
            rows.count { it.action == Metadata.Recurrence.KEEP },
            rows.none { it.conflict != null } &&
                (cancellations == 0 || !input.reason.isNullOrBlank()),
        )
    }

    @Transactional
    fun saveWithNewGroup(
        actor: UUID,
        key: String,
        input: NewGroupSeriesInput,
    ): SessionSeriesView =
        commands.execute(actor, "series-new-group", key, input, SessionSeriesView::class.java) {
            val rule = input.rule
            val parameters =
                ScheduleGroupInput(rule.title.trim(), rule.capacity, rule.ageFrom, rule.ageTo)
            validateGroup(parameters)
            val groupId = UUID.randomUUID()
            storage.saveGroup(groupId, parameters, true)
            storage.audit(
                groupId,
                actor,
                Metadata.Recurrence.GROUP_SAVED,
                UUID.randomUUID(),
                group = parameters,
            )
            val draft = SeriesDraftInput(groupId, rule = rule)
            preview(null, draft)
            val seriesId = UUID.randomUUID()
            storage.saveDraft(seriesId, draft, true)
            storage.audit(
                seriesId,
                actor,
                Metadata.Recurrence.DRAFT_SAVED,
                UUID.randomUUID(),
                draft.rule,
            )
            read(seriesId)
        }

    @Transactional
    fun save(actor: UUID, id: UUID?, key: String, input: SeriesDraftInput): SessionSeriesView =
        commands.execute(
            actor,
            "series-draft-save:$id",
            key,
            input,
            SessionSeriesView::class.java,
        ) {
            preview(id, input)
            val target = id ?: UUID.randomUUID()
            storage.saveDraft(target, input, id == null)
            storage.audit(
                target,
                actor,
                Metadata.Recurrence.DRAFT_SAVED,
                UUID.randomUUID(),
                input.rule,
            )
            read(target)
        }

    private fun check(id: UUID, input: SeriesCommand): SessionSeriesView {
        val state = read(id)
        if (
            state.version != input.expectedVersion ||
                state.draftVersion != input.expectedDraftVersion
        )
            conflict(Metadata.Recurrence.PLAN_STALE)
        return state
    }

    @Transactional
    fun discard(actor: UUID, id: UUID, key: String, input: SeriesCommand): SessionSeriesView =
        commands.execute(
            actor,
            "series-draft-discard:$id",
            key,
            input,
            SessionSeriesView::class.java,
        ) {
            check(id, input)
            storage.discard(id)
            storage.audit(id, actor, Metadata.Recurrence.DRAFT_DISCARDED, UUID.randomUUID())
            read(id)
        }

    @Transactional
    fun publish(actor: UUID, id: UUID, key: String, input: SeriesCommand): SessionSeriesView =
        commands.execute(actor, "series-publish:$id", key, input, SessionSeriesView::class.java) {
            val state = check(id, input)
            if (state.draftBaseVersion != state.version) conflict(Metadata.Recurrence.PLAN_STALE)
            val draft = state.draft ?: conflict(Metadata.Recurrence.PLAN_STALE)
            val plan =
                preview(
                    id,
                    draft.copy(
                        expectedVersion = state.version,
                        expectedDraftVersion = state.draftVersion,
                    ),
                )
            if (
                plan.items.any {
                    Metadata.Recurrence.BEFORE_CURRENT_WEEK in it.conflictCodes.orEmpty()
                }
            )
                conflict(Metadata.Recurrence.BEFORE_CURRENT_WEEK)
            if (plan.items.any { Metadata.Editor.FIELD_START in it.conflictCodes.orEmpty() })
                conflict(Metadata.Recurrence.START_PASSED)
            if (plan.digest != input.digest) conflict(Metadata.Recurrence.PLAN_STALE)
            if (plan.cancellations > 0 && draft.reason.isNullOrBlank())
                badRequest(Metadata.ErrorCodes.REASON_REQUIRED)
            if (!plan.canPublish)
                conflict(
                    if (
                        plan.items.any {
                            it.sessionId != null &&
                                Metadata.Recurrence.PARAMETER_CONFLICT in it.conflictCodes.orEmpty()
                        }
                    )
                        Metadata.Recurrence.DRAFT_CONFLICT
                    else Metadata.ErrorCodes.SCHEDULE_CONFLICT
                )
            val operation = UUID.randomUUID()
            for (row in plan.items.filter { it.action != Metadata.Recurrence.KEEP }) {
                val entity =
                    row.sessionId?.let { repository.findById(it).orElseThrow() }
                        ?: row.proposed!!.let {
                            StudioSession(
                                title = it.title,
                                format = it.format,
                                startsAt = it.startsAt,
                                endsAt = it.endsAt,
                                capacity = it.capacity,
                                ageFrom = it.ageFrom,
                                ageTo = it.ageTo,
                                status = Metadata.Scheduling.OPEN,
                            )
                        }
                if (row.action == Metadata.Recurrence.CANCEL)
                    entity.status = Metadata.Scheduling.CANCELLED
                else
                    row.proposed!!.let { p ->
                        entity.title = p.title
                        entity.startsAt = p.startsAt
                        entity.endsAt = p.endsAt
                        entity.capacity = p.capacity
                        entity.ageFrom = p.ageFrom
                        entity.ageTo = p.ageTo
                    }
                repository.saveAndFlush(entity)
                if (row.sessionId == null)
                    storage.link(entity.id, state.groupId, id, row.originalDate)
                commands.audit(
                    entity.id,
                    actor,
                    Metadata.Recurrence.PUBLISHED,
                    row.before,
                    SeriesSessionAudit(operation, sessions.find(entity.id)),
                    draft.reason,
                )
            }
            storage.publish(id, draft.rule)
            storage.audit(
                id,
                actor,
                Metadata.Recurrence.PUBLISHED,
                operation,
                draft.rule,
                plan.creates + plan.changes + plan.cancellations,
            )
            read(id)
        }

    @Transactional(
        readOnly = true,
        isolation = org.springframework.transaction.annotation.Isolation.REPEATABLE_READ,
    )
    fun calendar(from: java.time.Instant, to: java.time.Instant): SeriesCalendarContext {
        if (
            to <= from ||
                ChronoUnit.DAYS.between(from, to) > Metadata.SchedulingLimits.MAX_CALENDAR_DAYS
        )
            badRequest(Metadata.ErrorCodes.INVALID_RANGE)
        val ids = sessions.calendar(from, to).items.map { it.id }.toSet()
        val warnings = mutableListOf<String>()
        val plans =
            storage
                .series()
                .filter { it.draft != null }
                .mapNotNull { s ->
                    try {
                        preview(
                                s.id,
                                s.draft!!.copy(
                                    expectedVersion = s.version,
                                    expectedDraftVersion = s.draftVersion,
                                ),
                            )
                            .let { p ->
                                p.copy(
                                    items =
                                        p.items.filter {
                                            it.proposed?.let { v ->
                                                v.startsAt < to && v.endsAt > from
                                            } ?: false
                                        }
                                )
                            }
                    } catch (_: org.springframework.web.server.ResponseStatusException) {
                        warnings.add(messages.text(Metadata.Recurrence.PLAN_STALE))
                        null
                    }
                }
        return SeriesCalendarContext(
            storage.memberships().filter { it.sessionId in ids },
            plans,
            warnings,
        )
    }
}
