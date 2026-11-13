package ru.lastochka.scheduling.service

import java.security.MessageDigest
import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Isolation
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.FieldValidationException
import ru.lastochka.common.error.conflict
import ru.lastochka.common.error.notFound
import ru.lastochka.common.service.CommandService
import ru.lastochka.identity.service.ConceptStateService
import ru.lastochka.scheduling.dto.*
import ru.lastochka.scheduling.repo.AgeDirectionRepository
import ru.lastochka.scheduling.repo.PermanentScheduleRepository
import ru.lastochka.scheduling.repo.RecurrenceRepository
import ru.lastochka.scheduling.repo.StudioSessionRepository
import tools.jackson.databind.json.JsonMapper

/** Preview is read-only; publication repeats the entire check under the shared studio lock. */
@Service
class PermanentPlanService(
    private val directions: AgeDirectionRepository,
    private val permanent: PermanentScheduleRepository,
    private val recurrence: RecurrenceRepository,
    private val occurrence: PermanentOccurrenceService,
    private val sessions: SchedulingService,
    private val sessionRepository: StudioSessionRepository,
    private val concept: ConceptStateService,
    private val commands: CommandService,
    private val clock: Clock,
    private val json: JsonMapper,
) {
    private fun startedToday(revisions: List<ru.lastochka.scheduling.repo.PermanentRevisionProjection>,
        seriesId: UUID, today: LocalDate, now: Instant): Boolean = revisions.any { rule ->
        rule.seriesId == seriesId && rule.effectiveFrom <= today &&
            (rule.effectiveUntil == null || today < rule.effectiveUntil) &&
            rule.weekday == today.dayOfWeek.value &&
            today.atTime(rule.startTime).atZone(ZoneId.of(Metadata.Time.STUDIO_ZONE)).toInstant() <= now
    }

    private data class DraftIntervals(val intervals: List<PermanentSchedulePlan.BusyInterval>, val incomplete: Boolean)

    /** Parse all known saved drafts, bounded independently of the infinite rules. */
    private fun draftIntervals(now: Instant): DraftIntervals {
        val individual = permanent.sessionDraftPayloads()
        val series = permanent.seriesDraftPayloads()
        if (individual.size > Metadata.PermanentSchedule.MAX_ITEMS || series.size > Metadata.PermanentSchedule.MAX_ITEMS) return DraftIntervals(emptyList(), true)
        val intervals = mutableListOf<PermanentSchedulePlan.BusyInterval>()
        return try {
            individual.forEach { raw ->
                val draft = json.readValue(raw, SessionInput::class.java)
                require(draft.endsAt > draft.startsAt)
                if (draft.endsAt > now) intervals.add(PermanentSchedulePlan.BusyInterval(draft.startsAt, draft.endsAt))
            }
            val zone = ZoneId.of(Metadata.Time.STUDIO_ZONE)
            series.forEach { raw ->
                val draft = json.readValue(raw, SeriesDraftInput::class.java)
                if (!draft.cancelFollowing) {
                    val rule = draft.rule
                    val days = ChronoUnit.DAYS.between(rule.startDate, rule.endDate) + 1
                    require(days in 1..Metadata.Recurrence.MAX_DAYS && rule.weekdays.isNotEmpty() &&
                        rule.weekdays.distinct().size == rule.weekdays.size &&
                        rule.weekdays.all { it in 1..Metadata.Recurrence.LAST_WEEKDAY } && rule.durationMinutes in 1 until Metadata.PermanentSchedule.MAX_DURATION_MINUTES)
                    var occurrences = 0
                    for (offset in 0 until days) {
                        val date = rule.startDate.plusDays(offset)
                        if (date.dayOfWeek.value !in rule.weekdays) continue
                        require(++occurrences <= Metadata.Recurrence.MAX_OCCURRENCES)
                        val start = date.atTime(rule.startTime).atZone(zone).toInstant()
                        val end = start.plusSeconds(rule.durationMinutes.toLong() * Metadata.Recurrence.SECONDS_PER_MINUTE)
                        if (end > now) intervals.add(PermanentSchedulePlan.BusyInterval(start, end))
                        require(intervals.size <= Metadata.PermanentSchedule.MAX_ITEMS)
                    }
                }
            }
            DraftIntervals(intervals, false)
        } catch (_: RuntimeException) {
            DraftIntervals(emptyList(), true)
        }
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    fun list(): PermanentRuleList {
        val today = clock.instant().atZone(ZoneId.of(Metadata.Time.STUDIO_ZONE)).toLocalDate()
        val revisions = permanent.revisionsIn(today.minusDays(Metadata.PermanentSchedule.WEEK_DAYS), LocalDate.of(Metadata.PermanentSchedule.MAX_DATE_YEAR, Metadata.PermanentSchedule.MAX_DATE_MONTH, Metadata.PermanentSchedule.MAX_DATE_DAY))
        if (revisions.size > Metadata.PermanentSchedule.MAX_ITEMS) conflict(Metadata.ErrorCodes.CALENDAR_RANGE_TOO_DENSE)
        val ongoing = revisions.filter { it.effectiveUntil == null || it.effectiveUntil!! > today }
            .groupBy { it.seriesId }.map { (_, values) ->
                val ordered = values.sortedBy { it.effectiveFrom }
                if (ordered.zipWithNext().any { (a, b) -> a.effectiveUntil == null || a.effectiveUntil!! > b.effectiveFrom })
                    conflict(Metadata.ErrorCodes.SCHEDULE_CONFLICT)
                ordered.last()
            }
        return PermanentRuleList(ongoing.map {
            PermanentRuleView(it.seriesId, it.seriesVersion, it.directionId, it.title, it.effectiveFrom,
                it.weekday, it.startTime, it.durationMinutes, it.capacity, it.effectiveUntil)
        })
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    fun preview(input: PermanentPlanInput): PermanentPlanView = evaluate(input)

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    fun previewChange(input: PermanentRuleChange): PermanentPlanView = evaluate(input.plan, input)

    private fun evaluate(input: PermanentPlanInput, replacing: PermanentRuleChange? = null): PermanentPlanView {
        val fields = linkedMapOf<String, String>()
        val now = clock.instant()
        val today = now.atZone(ZoneId.of(Metadata.Time.STUDIO_ZONE)).toLocalDate()
        if (input.startDate < today || input.startDate > LocalDate.of(Metadata.PermanentSchedule.INPUT_DATE_MAX_YEAR, Metadata.PermanentSchedule.INPUT_DATE_MAX_MONTH, 1))
            fields["startDate"] = Metadata.ErrorCodes.FIELD_INVALID
        if (replacing != null && input.slots.size != 1)
            fields["startDate"] = Metadata.ErrorCodes.FIELD_INVALID
        if (input.capacity <= 0) fields["capacity"] = Metadata.ErrorCodes.FIELD_INVALID
        if (input.slots.isEmpty() || input.slots.size > Metadata.PermanentSchedule.MAX_SLOTS || input.slots.any {
                it.weekday !in 1..Metadata.Recurrence.LAST_WEEKDAY || it.durationMinutes !in 1 until Metadata.PermanentSchedule.MAX_DURATION_MINUTES ||
                    it.time.second != 0 || it.time.nano != 0
            }) fields["slots"] = Metadata.ErrorCodes.FIELD_INVALID
        if (fields.isNotEmpty()) throw FieldValidationException(fields)
        val direction = directions.findById(input.directionId).orElse(null)
            ?: notFound(Metadata.ErrorCodes.NOT_FOUND)
        if (!direction.active || direction.version != input.directionVersion)
            conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        if (replacing != null && permanent.permanentRevision(replacing.seriesId) != replacing.expectedVersion)
            conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        val first = today.minusDays(Metadata.PermanentSchedule.WEEK_DAYS)
        val last = LocalDate.of(Metadata.PermanentSchedule.MAX_DATE_YEAR, Metadata.PermanentSchedule.MAX_DATE_MONTH, Metadata.PermanentSchedule.MAX_DATE_DAY)
        val revisions = permanent.revisionsIn(first, last)
        if (replacing != null && input.startDate == today &&
            (startedToday(revisions, replacing.seriesId, today, now) || input.slots.any {
                it.weekday == today.dayOfWeek.value && today.atTime(it.time)
                    .atZone(ZoneId.of(Metadata.Time.STUDIO_ZONE)).toInstant() <= now
            })) throw FieldValidationException(mapOf("startDate" to Metadata.PermanentSchedule.CHANGE_AFTER_TODAY))
        val links = recurrence.membershipsBetween(revisions.map { it.seriesId }.distinct(), first, last)
        val busy = permanent.busyFuture(now)
        if (revisions.size > Metadata.PermanentSchedule.MAX_ITEMS || links.size > Metadata.PermanentSchedule.MAX_ITEMS || busy.size > Metadata.PermanentSchedule.MAX_ITEMS)
            conflict(Metadata.ErrorCodes.CALENDAR_RANGE_TOO_DENSE)
        val replaced = links.groupBy { it.seriesId }.mapValues { (_, values) ->
            values.mapNotNull { it.originalDate }.toSet()
        }
        val futureLinks = if (replacing == null) emptyList() else links.filter {
            it.seriesId == replacing.seriesId && !it.exception && it.originalDate != null &&
                it.originalDate >= input.startDate
        }
        val before = sessions.findMany(futureLinks.map { it.sessionId })
        val affected = futureLinks.map { link ->
            val date = requireNotNull(link.originalDate)
            val existing = before.getValue(link.sessionId)
            val old = revisions.filter { it.seriesId == replacing!!.seriesId && it.effectiveFrom <= date &&
                (it.effectiveUntil == null || date < it.effectiveUntil) && it.weekday == date.dayOfWeek.value }
            if (old.size != 1 || existing.status !in setOf(Metadata.Scheduling.OPEN, Metadata.Scheduling.CLOSED))
                conflict(Metadata.ErrorCodes.SCHEDULE_CONFLICT)
            val revision = old.single()
            val rule = PermanentRuleCalendar.Revision(revision.effectiveFrom, revision.effectiveUntil,
                revision.weekday, revision.startTime, revision.durationMinutes)
            val expected = PermanentRuleCalendar.occurrences(rule, date, date.plusDays(1)).single()
            if (existing.format != Metadata.Scheduling.GROUP ||
                existing.startsAt != expected.startsAt || existing.endsAt != expected.endsAt ||
                existing.title != revision.title || existing.capacity != revision.capacity ||
                existing.ageFrom != revision.ageFrom || existing.ageTo != revision.ageTo ||
                existing.ageOpenEnded != revision.ageOpenEnded)
                conflict(Metadata.ErrorCodes.SCHEDULE_CONFLICT)
            PermanentAffectedSession(existing, date,
                if (existing.startsAt <= now) Metadata.PermanentSchedule.KEEP_PAST
                else if (date.dayOfWeek.value == input.slots.single().weekday) Metadata.Recurrence.CHANGE else Metadata.Scheduling.CANCEL)
        }
        val changedIds = affected.filter { it.action != Metadata.PermanentSchedule.KEEP_PAST }.map { it.session.id }.toSet()
        val known = revisions.mapNotNull { item ->
            val end = if (item.seriesId == replacing?.seriesId) {
                if (item.effectiveFrom >= input.startDate) return@mapNotNull null
                minOf(item.effectiveUntil ?: input.startDate, input.startDate)
            } else item.effectiveUntil
            PermanentSchedulePlan.KnownRule(
                PermanentRuleCalendar.Revision(item.effectiveFrom, end,
                    item.weekday, item.startTime, item.durationMinutes),
                replaced[item.seriesId].orEmpty(),
            )
        }
        val drafts = draftIntervals(now)
        val exceptions = if (replacing == null) emptySet() else links.filter {
            it.seriesId == replacing.seriesId && it.exception
        }.mapNotNull { it.originalDate }.toSet()
        val plan = try {
            PermanentSchedulePlan.preview(input.startDate,
                input.slots.map { PermanentSchedulePlan.Slot(it.weekday, it.time, it.durationMinutes) },
                now, known, busy.filterNot { it.id in changedIds }.map { PermanentSchedulePlan.BusyInterval(it.startsAt, it.endsAt) },
                drafts.intervals, exceptions)
        } catch (error: IllegalStateException) {
            conflict(Metadata.ErrorCodes.CALENDAR_RANGE_TOO_DENSE)
        }
        val samples = plan.samples.map { group -> group.map { PermanentPlanSample(it.originalDate, it.startsAt, it.endsAt) } }
        val conflicts = plan.conflicts.map { PermanentPlanConflict(it.slot, it.source, it.originalDate) }
        val pendingDrafts = drafts.incomplete || recurrence.draftIds(changedIds.toList()).isNotEmpty() ||
            (replacing != null && permanent.hasSeriesDraft(replacing.seriesId))
        val digest = MessageDigest.getInstance(Metadata.Protocol.SHA256)
            .digest(json.writeValueAsBytes(listOf(input, replacing?.seriesId, replacing?.expectedVersion,
                direction.title, direction.version, samples, conflicts, pendingDrafts, affected)))
            .joinToString("") { "%02x".format(it) }
        return PermanentPlanView(direction.title, digest, samples, conflicts, pendingDrafts,
            conflicts.isEmpty() && !pendingDrafts, affected)
    }

    @Transactional
    fun publish(actor: UUID, key: String, input: PermanentPlanPublish): PermanentPlanPublished =
        commands.execute(actor, "permanent-plan-publish", key, input, PermanentPlanPublished::class.java) {
            val mode = concept.mode()
            if (mode !in setOf(Metadata.Concept.MODE, Metadata.Concept.PERMANENT_SCHEDULE_MODE))
                conflict(Metadata.ErrorCodes.SCHEDULE_UPDATE_REQUIRED)
            val result = evaluate(input.plan)
            if (result.digest != input.digest) conflict(Metadata.Recurrence.PLAN_STALE)
            if (!result.canPublish) conflict(Metadata.ErrorCodes.SCHEDULE_CONFLICT)
            // The compatibility marker and all rules commit together. Older backend
            // versions reject this mode at startup rather than editing it blindly.
            if (mode == Metadata.Concept.MODE && concept.transition(mode, Metadata.Concept.PERMANENT_SCHEDULE_MODE) != 1)
                conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            val direction = directions.findById(input.plan.directionId).orElseThrow()
            val series = input.plan.slots.map { slot ->
                val groupId = UUID.randomUUID()
                val seriesId = UUID.randomUUID()
                recurrence.saveGroup(groupId, ScheduleGroupInput(direction.title, input.plan.capacity,
                    direction.ageFrom, direction.ageTo, direction.ageOpenEnded), true)
                recurrence.createPermanentSeries(seriesId, groupId, direction.id)
                permanent.addPermanentSeries(seriesId)
                permanent.advanceRevision(seriesId, 0)
                permanent.addRevision(seriesId, 1, input.plan.startDate, null, slot.weekday,
                    slot.time, slot.durationMinutes, direction.id, direction.title, input.plan.capacity,
                    direction.ageFrom, direction.ageTo, direction.ageOpenEnded)
                commands.audit(seriesId, actor, Metadata.PermanentSchedule.RULE_PUBLISHED, null, input.plan)
                seriesId
            }
            PermanentPlanPublished(series)
        }

    @Transactional
    fun change(actor: UUID, key: String, input: PermanentRuleChangePublish): PermanentRuleChanged =
        commands.execute(actor, "permanent-rule-change:${input.change.seriesId}", key, input, PermanentRuleChanged::class.java) {
            if (concept.mode() != Metadata.Concept.PERMANENT_SCHEDULE_MODE)
                conflict(Metadata.ErrorCodes.SCHEDULE_UPDATE_REQUIRED)
            val change = input.change
            val result = evaluate(change.plan, change)
            if (result.digest != input.digest) conflict(Metadata.Recurrence.PLAN_STALE)
            if (!result.canPublish) conflict(Metadata.ErrorCodes.SCHEDULE_CONFLICT)
            val direction = directions.findById(change.plan.directionId).orElseThrow()
            val slot = change.plan.slots.single()
            val zone = ZoneId.of(Metadata.Time.STUDIO_ZONE)
            for (item in result.affected) {
                val entity = sessionRepository.findById(item.session.id).orElseThrow()
                if (entity.version != item.session.version) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
                if (item.action == Metadata.PermanentSchedule.KEEP_PAST) {
                    recurrence.touch(entity.id, true)
                } else if (item.action == Metadata.Scheduling.CANCEL) {
                    entity.status = Metadata.Scheduling.CANCELLED
                    recurrence.touch(entity.id, true)
                } else {
                    val starts = item.originalDate.atTime(slot.time).atZone(zone).toInstant()
                    entity.title = direction.title
                    entity.startsAt = starts
                    entity.endsAt = starts.plusSeconds(slot.durationMinutes.toLong() * Metadata.Recurrence.SECONDS_PER_MINUTE)
                    entity.capacity = change.plan.capacity
                    entity.ageFrom = direction.ageFrom
                    entity.ageTo = direction.ageTo
                }
                sessionRepository.saveAndFlush(entity)
                commands.audit(entity.id, actor, Metadata.PermanentSchedule.RULE_CHANGED, item.session, sessions.find(entity.id))
            }
            permanent.supersedeFuture(change.seriesId, change.plan.startDate)
            permanent.endCurrentAt(change.seriesId, change.plan.startDate)
            if (permanent.advanceRevision(change.seriesId, change.expectedVersion) != 1)
                conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            val next = change.expectedVersion + 1
            permanent.addRevision(change.seriesId, next, change.plan.startDate, null, slot.weekday,
                slot.time, slot.durationMinutes, direction.id, direction.title, change.plan.capacity,
                direction.ageFrom, direction.ageTo, direction.ageOpenEnded)
            permanent.updateDirection(change.seriesId, direction.id)
            val after = PermanentRuleChanged(change.seriesId, next)
            commands.audit(change.seriesId, actor, Metadata.PermanentSchedule.RULE_CHANGED, change, after)
            after
        }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    fun previewStop(input: PermanentRuleStop): PermanentStopPreview = evaluateStop(input)

    private fun evaluateStop(input: PermanentRuleStop): PermanentStopPreview {
        val now = clock.instant()
        val today = now.atZone(ZoneId.of(Metadata.Time.STUDIO_ZONE)).toLocalDate()
        if (input.boundary < today || input.boundary > LocalDate.of(Metadata.PermanentSchedule.INPUT_DATE_MAX_YEAR, Metadata.PermanentSchedule.INPUT_DATE_MAX_MONTH, 1))
            throw FieldValidationException(mapOf("boundary" to Metadata.ErrorCodes.FIELD_INVALID))
        if (permanent.permanentRevision(input.seriesId) != input.expectedVersion)
            conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        val end = LocalDate.of(Metadata.PermanentSchedule.MAX_DATE_YEAR, Metadata.PermanentSchedule.MAX_DATE_MONTH, Metadata.PermanentSchedule.MAX_DATE_DAY)
        val allRevisions = permanent.revisionsIn(today.minusDays(Metadata.PermanentSchedule.WEEK_DAYS), end)
        if (allRevisions.size > Metadata.PermanentSchedule.MAX_ITEMS) conflict(Metadata.ErrorCodes.CALENDAR_RANGE_TOO_DENSE)
        val revisions = allRevisions.filter { it.seriesId == input.seriesId }
        if (input.boundary == today && startedToday(revisions, input.seriesId, today, now))
            throw FieldValidationException(mapOf("boundary" to Metadata.PermanentSchedule.CHANGE_AFTER_TODAY))
        if (revisions.none { it.effectiveUntil == null || it.effectiveUntil!! > input.boundary })
            conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        val links = recurrence.membershipsBetween(listOf(input.seriesId), input.boundary, end)
        if (links.size > Metadata.PermanentSchedule.MAX_ITEMS) conflict(Metadata.ErrorCodes.CALENDAR_RANGE_TOO_DENSE)
        val regular = links.filterNot { it.exception }
        val current = sessions.findMany(regular.map { it.sessionId })
        val affected = regular.map { link ->
            val date = requireNotNull(link.originalDate)
            val session = current.getValue(link.sessionId)
            val version = revisions.filter { it.effectiveFrom <= date &&
                (it.effectiveUntil == null || date < it.effectiveUntil) && it.weekday == date.dayOfWeek.value }
            if (version.size != 1 || session.status !in setOf(Metadata.Scheduling.OPEN, Metadata.Scheduling.CLOSED))
                conflict(Metadata.ErrorCodes.SCHEDULE_CONFLICT)
            val rule = version.single()
            val shape = PermanentRuleCalendar.Revision(rule.effectiveFrom, rule.effectiveUntil,
                rule.weekday, rule.startTime, rule.durationMinutes)
            val expected = PermanentRuleCalendar.occurrences(shape, date, date.plusDays(1)).single()
            if (session.format != Metadata.Scheduling.GROUP || session.startsAt != expected.startsAt ||
                session.endsAt != expected.endsAt || session.title != rule.title ||
                session.capacity != rule.capacity || session.ageFrom != rule.ageFrom ||
                session.ageTo != rule.ageTo || session.ageOpenEnded != rule.ageOpenEnded)
                conflict(Metadata.ErrorCodes.SCHEDULE_CONFLICT)
            PermanentAffectedSession(session, date, if (session.startsAt <= now) Metadata.PermanentSchedule.KEEP_PAST else Metadata.Scheduling.CANCEL)
        }
        val pending = recurrence.draftIds(regular.map { it.sessionId }).isNotEmpty() || permanent.hasSeriesDraft(input.seriesId)
        val digest = MessageDigest.getInstance(Metadata.Protocol.SHA256)
            .digest(json.writeValueAsBytes(listOf(input, affected, pending)))
            .joinToString("") { "%02x".format(it) }
        return PermanentStopPreview(digest, affected, pending, !pending)
    }

    @Transactional
    fun stop(actor: UUID, key: String, input: PermanentStopPublish): PermanentRuleChanged =
        commands.execute(actor, "permanent-rule-stop:${input.stop.seriesId}", key, input, PermanentRuleChanged::class.java) {
            if (concept.mode() != Metadata.Concept.PERMANENT_SCHEDULE_MODE)
                conflict(Metadata.ErrorCodes.SCHEDULE_UPDATE_REQUIRED)
            val plan = evaluateStop(input.stop)
            if (plan.digest != input.digest) conflict(Metadata.Recurrence.PLAN_STALE)
            if (!plan.canPublish) conflict(Metadata.ErrorCodes.SCHEDULE_CONFLICT)
            for (item in plan.affected) {
                val entity = sessionRepository.findById(item.session.id).orElseThrow()
                if (entity.version != item.session.version) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
                if (item.action == Metadata.Scheduling.CANCEL) entity.status = Metadata.Scheduling.CANCELLED
                recurrence.touch(entity.id, true)
                sessionRepository.saveAndFlush(entity)
                commands.audit(entity.id, actor, Metadata.PermanentSchedule.RULE_STOPPED, item.session, sessions.find(entity.id))
            }
            permanent.supersedeFuture(input.stop.seriesId, input.stop.boundary)
            permanent.endCurrentAt(input.stop.seriesId, input.stop.boundary)
            if (permanent.advanceRevision(input.stop.seriesId, input.stop.expectedVersion) != 1)
                conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            val result = PermanentRuleChanged(input.stop.seriesId, input.stop.expectedVersion + 1)
            commands.audit(input.stop.seriesId, actor, Metadata.PermanentSchedule.RULE_STOPPED, input.stop, result)
            result
        }

    @Transactional
    fun materialize(actor: UUID, key: String, reference: ScheduleRuleReference): SessionView =
        commands.execute(actor, "permanent-date-materialize", key, reference, SessionView::class.java) {
            if (reference.referenceVersion != 1 || reference.seriesVersion < 1)
                conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            occurrence.materialize(reference.seriesId, reference.originalDate, reference.seriesVersion)
        }
}
