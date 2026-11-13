package ru.lastochka.scheduling.service

import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.FieldValidationException
import ru.lastochka.common.error.conflict
import ru.lastochka.common.error.notFound
import ru.lastochka.common.service.CommandService
import ru.lastochka.scheduling.dto.AgeDirectionList
import ru.lastochka.scheduling.dto.AgeDirectionUpdate
import ru.lastochka.scheduling.dto.AgeDirectionView
import ru.lastochka.scheduling.entity.AgeDirection
import ru.lastochka.scheduling.repo.AgeDirectionRepository

@Service
class AgeDirectionService(
    private val repository: AgeDirectionRepository,
    private val commands: CommandService,
) {
    private fun view(item: AgeDirection) =
        AgeDirectionView(
            item.id,
            item.title,
            item.description,
            item.ageFrom,
            item.ageTo,
            item.ageOpenEnded,
            item.active,
            item.sortOrder,
            requireNotNull(item.version),
        )

    @Transactional(readOnly = true)
    fun active() =
        AgeDirectionList(
            repository.findAllByActiveTrueOrderBySortOrderAscTitleAscIdAsc().map(::view)
        )

    @Transactional(readOnly = true)
    fun all() = AgeDirectionList(repository.findAllByOrderBySortOrderAscTitleAscIdAsc().map(::view))

    @Transactional
    fun save(actor: UUID, id: UUID?, key: String, input: AgeDirectionUpdate): AgeDirectionView =
        commands.execute(
            actor,
            "age-direction-save:$id",
            key,
            input,
            AgeDirectionView::class.java,
        ) {
            val fields = linkedMapOf<String, String>()
            if (input.title.isBlank() || input.title.trim().length > Metadata.PermanentSchedule.MAX_DIRECTION_TITLE)
                fields["title"] = Metadata.ErrorCodes.FIELD_LENGTH
            if (input.description.length > Metadata.PermanentSchedule.MAX_DIRECTION_DESCRIPTION)
                fields["description"] = Metadata.ErrorCodes.FIELD_LENGTH
            if (
                input.ageFrom !in 0..Metadata.PermanentSchedule.MAX_ADULT_AGE ||
                    (input.ageOpenEnded && input.ageTo != null) ||
                    (!input.ageOpenEnded &&
                        (input.ageTo == null || input.ageTo !in input.ageFrom..Metadata.PermanentSchedule.MAX_ADULT_AGE))
            )
                fields["ageFrom"] = Metadata.ErrorCodes.FIELD_INVALID
            if (fields.isNotEmpty()) throw FieldValidationException(fields)
            val item =
                id?.let {
                    repository.findById(it).orElse(null) ?: notFound(Metadata.ErrorCodes.NOT_FOUND)
                }
            if ((item?.version ?: 0) != input.expectedVersion)
                conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            val before = item?.let(::view)
            val target =
                item
                    ?: AgeDirection(
                        title = input.title.trim(),
                        description = input.description.trim(),
                        ageFrom = input.ageFrom,
                        ageTo = input.ageTo,
                        ageOpenEnded = input.ageOpenEnded,
                        active = input.active,
                        sortOrder = input.sortOrder,
                    )
            target.title = input.title.trim()
            target.description = input.description.trim()
            target.ageFrom = input.ageFrom
            target.ageTo = input.ageTo
            target.ageOpenEnded = input.ageOpenEnded
            target.active = input.active
            target.sortOrder = input.sortOrder
            val after = view(repository.saveAndFlush(target))
            commands.audit(target.id, actor, Metadata.PermanentSchedule.AGE_DIRECTION_SAVED, before, after)
            after
        }
}
