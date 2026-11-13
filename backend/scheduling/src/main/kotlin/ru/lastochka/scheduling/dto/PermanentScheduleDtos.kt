package ru.lastochka.scheduling.dto

import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import io.swagger.v3.oas.annotations.media.Schema

/** The calculated reference is a rule/date/version tuple, never an invented session UUID. */
@Schema(requiredProperties = ["seriesId", "originalDate", "seriesVersion", "title", "startsAt", "endsAt", "capacity", "ageFrom", "ageOpenEnded"])
data class CalculatedSessionView(
    val seriesId: UUID,
    val originalDate: LocalDate,
    val seriesVersion: Long,
    val title: String,
    val startsAt: Instant,
    val endsAt: Instant,
    val capacity: Int,
    val ageFrom: Int,
    val ageTo: Int?,
    val ageOpenEnded: Boolean,
)

enum class ScheduleOccurrenceKind { SESSION, CALCULATED }

@Schema(requiredProperties = ["referenceVersion", "seriesId", "originalDate", "seriesVersion"])
data class ScheduleRuleReference(
    val referenceVersion: Int,
    val seriesId: UUID,
    val originalDate: LocalDate,
    val seriesVersion: Long,
)

@Schema(requiredProperties = ["kind"])
data class ScheduleOccurrenceView(
    val kind: ScheduleOccurrenceKind,
    val session: SessionView? = null,
    val calculated: CalculatedSessionView? = null,
    val origin: ScheduleRuleReference? = null,
)

@Schema(requiredProperties = ["items", "page", "size", "total", "containsCalculated"])
data class ProjectedSchedulePage(
    val items: List<ScheduleOccurrenceView>,
    val page: Int,
    val size: Int,
    val total: Long,
    val containsCalculated: Boolean,
)
