package ru.lastochka.scheduling.service

import java.time.LocalTime
import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Isolation
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.FieldValidationException
import ru.lastochka.common.error.conflict
import ru.lastochka.common.service.CommandService
import ru.lastochka.scheduling.dto.*
import ru.lastochka.scheduling.entity.WeeklySlot
import ru.lastochka.scheduling.repo.WeeklySlotRepository

@Service
class WeeklyScheduleService(
    private val slots: WeeklySlotRepository,
    private val directions: AgeDirectionService,
    private val commands: CommandService,
) {
    private fun view(s: WeeklySlot) =
        WeeklyInterval(WeeklyReference(s.id, s.revision), s.directionId, s.weekday, s.startMinute, s.durationMinutes)

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    fun current(admin: Boolean = false): WeeklySchedule {
        val categories = if (admin) directions.all().items else directions.active().items
        val order = categories.mapIndexed { i, direction -> direction.id to i }.toMap()
        return WeeklySchedule(categories, slots.findAll().filter { it.directionId in order }.map(::view)
            .sortedWith(compareBy({ order[it.directionId] }, { it.weekday }, { it.startMinute })))
    }

    @Transactional
    fun save(actor: UUID, key: String, id: UUID?, input: WeeklySlotInput): WeeklyInterval =
        commands.execute(actor, "weekly-save:$id", key, input, WeeklyInterval::class.java) {
            val before = id?.let { existing(it, input.expectedRevision) }
            if (id == null && input.expectedRevision != 0L) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            val invalid = mutableMapOf<String, String>()
            if (directions.activeById(input.directionId) == null) invalid["directionId"] = Metadata.ErrorCodes.FIELD_INVALID
            if (input.weekday !in 1..Metadata.PermanentSchedule.DAYS_PER_WEEK) invalid["weekday"] = Metadata.ErrorCodes.FIELD_INVALID
            if (input.startMinute !in 0 until Metadata.PermanentSchedule.MINUTES_PER_DAY) invalid["startMinute"] = Metadata.ErrorCodes.FIELD_INVALID
            if (input.durationMinutes !in 1 until Metadata.PermanentSchedule.MAX_DURATION_MINUTES)
                invalid["durationMinutes"] = Metadata.ErrorCodes.FIELD_INVALID
            if (invalid.isNotEmpty()) throw FieldValidationException(invalid)
            val candidate = WeeklySlot(id ?: UUID.randomUUID(), slots.nextRevision(), input.directionId,
                input.weekday, input.startMinute, input.durationMinutes)
            if (slots.findAll().any { it.id != id && WeeklyPatternConflicts.overlap(pattern(it), pattern(candidate)) })
                conflict(Metadata.ErrorCodes.SCHEDULE_CONFLICT)
            val after = view(slots.saveAndFlush(candidate))
            commands.audit(candidate.id, actor, Metadata.PermanentSchedule.WEEKLY_SAVED, before, after)
            after
        }

    @Transactional
    fun withdraw(actor: UUID, key: String, id: UUID, revision: Long): WeeklyReference =
        commands.execute(actor, "weekly-withdraw:$id", key, revision, WeeklyReference::class.java) {
            val before = existing(id, revision)
            slots.deleteById(id)
            commands.audit(id, actor, Metadata.PermanentSchedule.WEEKLY_WITHDRAWN, before, null)
            before.reference
        }

    private fun existing(id: UUID, revision: Long) =
        slots.findById(id).orElse(null)?.takeIf { it.revision == revision }?.let(::view)
            ?: conflict(Metadata.ErrorCodes.VERSION_CONFLICT)

    private fun pattern(s: WeeklySlot) = WeeklyPatternConflicts.Pattern(setOf(s.weekday),
        LocalTime.ofSecondOfDay(s.startMinute * Metadata.Recurrence.SECONDS_PER_MINUTE), s.durationMinutes)
}
