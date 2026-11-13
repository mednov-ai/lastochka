package ru.lastochka.scheduling.dto

import ru.lastochka.common.Metadata
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID
import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema

@Schema(requiredProperties = ["weekday", "time", "durationMinutes"])
data class PermanentSlotInput(@param:JsonProperty(required = true) val weekday: Int,
    @param:JsonProperty(required = true) val time: LocalTime, val durationMinutes: Int = Metadata.PermanentSchedule.DEFAULT_DURATION_MINUTES)
@Schema(requiredProperties = ["directionId", "directionVersion", "startDate", "capacity", "slots"])
data class PermanentPlanInput(
    @param:JsonProperty(required = true) val directionId: UUID,
    @param:JsonProperty(required = true) val directionVersion: Long,
    @param:JsonProperty(required = true) val startDate: LocalDate,
    val capacity: Int = Metadata.Recurrence.DEFAULT_CAPACITY,
    @param:JsonProperty(required = true) val slots: List<PermanentSlotInput>,
)
@Schema(requiredProperties = ["date", "startsAt", "endsAt"])
data class PermanentPlanSample(val date: LocalDate, val startsAt: Instant, val endsAt: Instant)
@Schema(requiredProperties = ["slot", "source", "date"])
data class PermanentPlanConflict(val slot: Int, val source: String, val date: LocalDate)
@Schema(requiredProperties = ["session", "originalDate", "action"])
data class PermanentAffectedSession(val session: SessionView, val originalDate: LocalDate, val action: String)
@Schema(requiredProperties = ["directionTitle", "digest", "samples", "conflicts", "hasPendingDrafts", "canPublish", "affected"])
data class PermanentPlanView(
    val directionTitle: String,
    val digest: String,
    val samples: List<List<PermanentPlanSample>>,
    val conflicts: List<PermanentPlanConflict>,
    val hasPendingDrafts: Boolean,
    val canPublish: Boolean,
    val affected: List<PermanentAffectedSession> = emptyList(),
)
@Schema(requiredProperties = ["plan", "digest"])
data class PermanentPlanPublish(@param:JsonProperty(required = true) val plan: PermanentPlanInput,
    @param:JsonProperty(required = true) val digest: String)
@Schema(requiredProperties = ["seriesIds"])
data class PermanentPlanPublished(val seriesIds: List<UUID>)

@Schema(requiredProperties = ["seriesId", "expectedVersion", "plan"])
data class PermanentRuleChange(
    @param:JsonProperty(required = true) val seriesId: UUID,
    @param:JsonProperty(required = true) val expectedVersion: Long,
    @param:JsonProperty(required = true) val plan: PermanentPlanInput,
)
@Schema(requiredProperties = ["change", "digest"])
data class PermanentRuleChangePublish(
    @param:JsonProperty(required = true) val change: PermanentRuleChange,
    @param:JsonProperty(required = true) val digest: String,
)
@Schema(requiredProperties = ["seriesId", "version"])
data class PermanentRuleChanged(val seriesId: UUID, val version: Long)

@Schema(requiredProperties = ["seriesId", "version", "directionId", "title", "startDate", "weekday", "time", "durationMinutes", "capacity"])
data class PermanentRuleView(
    val seriesId: UUID, val version: Long, val directionId: UUID, val title: String,
    val startDate: LocalDate, val weekday: Int, val time: LocalTime,
    val durationMinutes: Int, val capacity: Int,
    val endDateExclusive: LocalDate? = null,
)
@Schema(requiredProperties = ["items"])
data class PermanentRuleList(val items: List<PermanentRuleView>)

@Schema(requiredProperties = ["seriesId", "expectedVersion", "boundary"])
data class PermanentRuleStop(
    @param:JsonProperty(required = true) val seriesId: UUID,
    @param:JsonProperty(required = true) val expectedVersion: Long,
    @param:JsonProperty(required = true) val boundary: LocalDate,
)
@Schema(requiredProperties = ["digest", "affected", "hasPendingDrafts", "canPublish"])
data class PermanentStopPreview(val digest: String, val affected: List<PermanentAffectedSession>,
    val hasPendingDrafts: Boolean, val canPublish: Boolean)
@Schema(requiredProperties = ["stop", "digest"])
data class PermanentStopPublish(@param:JsonProperty(required = true) val stop: PermanentRuleStop,
    @param:JsonProperty(required = true) val digest: String)
