package ru.lastochka.scheduling.dto

import java.time.LocalDate
import java.util.UUID
import io.swagger.v3.oas.annotations.media.Schema

@Schema(requiredProperties = ["referenceVersion", "seriesId", "originalDate", "seriesVersion"])
data class ScheduleRuleReference(
    val referenceVersion: Int,
    val seriesId: UUID,
    val originalDate: LocalDate,
    val seriesVersion: Long,
)
