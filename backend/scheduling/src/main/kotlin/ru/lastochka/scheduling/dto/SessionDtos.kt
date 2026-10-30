package ru.lastochka.scheduling.dto

import io.swagger.v3.oas.annotations.media.Schema
import jakarta.validation.constraints.*
import java.time.Instant
import java.util.UUID
import ru.lastochka.common.Metadata

data class SessionInput(
    @field:NotBlank
    @field:Size(max = Metadata.Limits.MAX_NAME_LENGTH)
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val title: String,
    @field:Pattern(regexp = Metadata.Scheduling.FORMAT_PATTERN)
    @field:Schema(
        requiredMode = Schema.RequiredMode.REQUIRED,
        allowableValues = [Metadata.Scheduling.GROUP, Metadata.Scheduling.INDIVIDUAL],
    )
    val format: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val startsAt: Instant,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val endsAt: Instant,
    @field:Min(1) @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val capacity: Int,
    @field:Schema(nullable = true) val ageFrom: Int? = null,
    @field:Schema(nullable = true) val ageTo: Int? = null,
    @field:Schema(description = "Явно заменить возраст, включая очистку обеих границ")
    val replaceAgeRange: Boolean = false,
    @field:Schema(
        nullable = true,
        description = "Группа; отсутствие поля в прежнем запросе сохраняет связь",
    )
    val groupId: UUID? = null,
    @field:Schema(description = "Явно заменить принадлежность группе; серия не изменяется")
    val replaceGroup: Boolean = false,
)

data class SessionUpdate(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val expectedVersion: Long,
    @field:jakarta.validation.Valid
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val session: SessionInput,
)

data class SessionAction(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val expectedVersion: Long,
    @field:Pattern(regexp = Metadata.Scheduling.ACTION_PATTERN)
    @field:Schema(
        requiredMode = Schema.RequiredMode.REQUIRED,
        allowableValues =
            [
                Metadata.Scheduling.PUBLISH,
                Metadata.Scheduling.CLOSE,
                Metadata.Scheduling.REOPEN,
                Metadata.Scheduling.CANCEL,
            ],
    )
    val action: String,
    @field:Size(max = Metadata.Limits.MAX_REASON_LENGTH)
    @field:Schema(nullable = true)
    val reason: String? = null,
)

data class SessionView(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val id: UUID,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val title: String,
    @field:Schema(
        requiredMode = Schema.RequiredMode.REQUIRED,
        allowableValues = [Metadata.Scheduling.GROUP, Metadata.Scheduling.INDIVIDUAL],
    )
    val format: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val startsAt: Instant,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val endsAt: Instant,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val capacity: Int,
    @field:Schema(
        requiredMode = Schema.RequiredMode.REQUIRED,
        allowableValues =
            [
                Metadata.Scheduling.DRAFT,
                Metadata.Scheduling.OPEN,
                Metadata.Scheduling.CLOSED,
                Metadata.Scheduling.CANCELLED,
            ],
    )
    val status: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val version: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val zone: String = Metadata.Time.STUDIO_ZONE,
    @field:Schema(nullable = true) val ageFrom: Int? = null,
    @field:Schema(nullable = true) val ageTo: Int? = null,
)

data class SessionPage(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val items: List<SessionView>,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val page: Int,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val size: Int,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val total: Long,
)
