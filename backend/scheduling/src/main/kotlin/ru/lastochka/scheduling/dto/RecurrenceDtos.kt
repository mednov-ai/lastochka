package ru.lastochka.scheduling.dto

import com.fasterxml.jackson.annotation.JsonInclude
import io.swagger.v3.oas.annotations.media.Schema
import jakarta.validation.Valid
import jakarta.validation.constraints.*
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID
import ru.lastochka.common.Metadata

@Schema(requiredProperties = ["name", "capacity"])
data class ScheduleGroupInput(
    @field:NotBlank @field:Size(max = Metadata.Limits.MAX_NAME_LENGTH) val name: String,
    @field:Min(1) val capacity: Int = Metadata.Recurrence.DEFAULT_CAPACITY,
    val ageFrom: Int? = null,
    val ageTo: Int? = null,
    @field:Schema(description = "Возраст от ageFrom без верхнего предела; null — прежний клиент")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    val ageOpenEnded: Boolean? = null,
)

@Schema(requiredProperties = ["id", "version", "parameters"])
data class ScheduleGroupView(val id: UUID, val version: Long, val parameters: ScheduleGroupInput)

@Schema(requiredProperties = ["items"])
data class ScheduleGroupList(val items: List<ScheduleGroupView>)

@Schema(requiredProperties = ["expectedVersion", "parameters"])
data class ScheduleGroupUpdate(
    val expectedVersion: Long,
    @field:Valid val parameters: ScheduleGroupInput,
)

@Schema(
    requiredProperties =
        ["startDate", "endDate", "weekdays", "startTime", "durationMinutes", "title", "capacity"]
)
data class SeriesRule(
    @field:Schema(description = "Включительная первая дата и граница будущей части, МСК")
    val startDate: LocalDate,
    @field:Schema(description = "Включительная последняя дата, не более 366 календарных дней")
    val endDate: LocalDate,
    @field:Schema(description = "Уникальные дни ISO: понедельник=1, воскресенье=7")
    val weekdays: List<Int>,
    @field:Schema(type = "string", example = "18:00") val startTime: LocalTime,
    @field:Min(1) val durationMinutes: Int,
    @field:NotBlank @field:Size(max = Metadata.Limits.MAX_NAME_LENGTH) val title: String,
    @field:Min(1) val capacity: Int,
    val ageFrom: Int? = null,
    val ageTo: Int? = null,
    @field:Schema(description = "Возраст от ageFrom без верхнего предела; null — прежний клиент")
    @field:JsonInclude(JsonInclude.Include.NON_NULL)
    val ageOpenEnded: Boolean? = null,
)

@Schema(requiredProperties = ["groupId", "expectedVersion", "rule", "cancelFollowing"])
data class SeriesDraftInput(
    val groupId: UUID,
    val expectedVersion: Long = 0,
    val expectedDraftVersion: Long? = null,
    @field:Valid val rule: SeriesRule,
    @field:Size(max = Metadata.Limits.MAX_REASON_LENGTH) val reason: String? = null,
    val cancelFollowing: Boolean = false,
)

@Schema(requiredProperties = ["rule"])
data class NewGroupSeriesInput(@field:Valid val rule: SeriesRule)

@Schema(requiredProperties = ["id", "groupId", "version"])
data class SessionSeriesView(
    val id: UUID,
    val groupId: UUID,
    val version: Long,
    val rule: SeriesRule? = null,
    val draft: SeriesDraftInput? = null,
    val draftVersion: Long? = null,
    val draftBaseVersion: Long? = null,
)

@Schema(requiredProperties = ["items"])
data class SessionSeriesList(val items: List<SessionSeriesView>)

@Schema(requiredProperties = ["expectedVersion"])
data class SeriesCommand(
    val expectedVersion: Long,
    val expectedDraftVersion: Long? = null,
    val digest: String? = null,
)

@Schema(requiredProperties = ["originalDate", "action", "exception"])
data class SeriesPlanRow(
    val originalDate: LocalDate,
    val action: String,
    val sessionId: UUID? = null,
    val version: Long? = null,
    val before: SessionView? = null,
    val proposed: SessionInput? = null,
    val conflict: String? = null,
    val exception: Boolean = false,
    val conflictCodes: List<String>? = null,
)

@Schema(
    requiredProperties =
        [
            "groupId",
            "digest",
            "items",
            "total",
            "creates",
            "changes",
            "cancellations",
            "retained",
            "canPublish",
        ]
)
data class SeriesPlan(
    val seriesId: UUID?,
    val groupId: UUID,
    val digest: String,
    val items: List<SeriesPlanRow>,
    val total: Int,
    val creates: Int,
    val changes: Int,
    val cancellations: Int,
    val retained: Int,
    val canPublish: Boolean,
)

@Schema(requiredProperties = ["sessionId", "groupId", "groupName", "exception"])
data class SessionMembership(
    val sessionId: UUID,
    val groupId: UUID,
    val groupName: String,
    val seriesId: UUID? = null,
    val originalDate: LocalDate? = null,
    val exception: Boolean = false,
    val permanent: Boolean = false,
)

@Schema(requiredProperties = ["memberships", "drafts", "warnings"])
data class SeriesCalendarContext(
    val memberships: List<SessionMembership>,
    val drafts: List<SeriesPlan>,
    val warnings: List<String> = emptyList(),
)

@Schema(requiredProperties = ["id", "action", "author", "occurredAt", "operationId", "affected"])
data class RecurrenceHistoryEntry(
    val id: Long,
    val action: String,
    val author: String,
    val occurredAt: Instant,
    val operationId: UUID,
    val affected: Int,
    val rule: SeriesRule? = null,
    val groupParameters: ScheduleGroupInput? = null,
)

@Schema(requiredProperties = ["items", "total", "page"])
data class RecurrenceHistory(
    val items: List<RecurrenceHistoryEntry>,
    val total: Long,
    val page: Int,
)

@Schema(requiredProperties = ["operationId", "session"])
data class SeriesSessionAudit(val operationId: UUID, val session: SessionView)
