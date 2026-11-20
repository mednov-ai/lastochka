package ru.lastochka.scheduling.dto

import io.swagger.v3.oas.annotations.media.Schema
import java.util.UUID

@Schema(requiredProperties = ["seriesId", "revision"])
data class WeeklyReference(val seriesId: UUID, val revision: Long)

@Schema(requiredProperties = ["reference", "directionId", "weekday", "startMinute", "durationMinutes"])
data class WeeklyInterval(
    val reference: WeeklyReference,
    val directionId: UUID,
    val weekday: Int,
    val startMinute: Int,
    val durationMinutes: Int,
)

@Schema(requiredProperties = ["directions", "intervals"])
data class WeeklySchedule(val directions: List<AgeDirectionView>, val intervals: List<WeeklyInterval>)

@Schema(requiredProperties = ["expectedRevision", "directionId", "weekday", "startMinute", "durationMinutes"])
data class WeeklySlotInput(
    val expectedRevision: Long,
    val directionId: UUID,
    val weekday: Int,
    val startMinute: Int,
    val durationMinutes: Int,
)
