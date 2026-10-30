package ru.lastochka.scheduling.dto

import io.swagger.v3.oas.annotations.media.Schema
import java.time.Instant
import ru.lastochka.common.Metadata

data class CalendarView(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val items: List<SessionView>,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val from: Instant,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val to: Instant,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val zone: String = Metadata.Time.STUDIO_ZONE,
)
