package ru.lastochka.identity.dto

import io.swagger.v3.oas.annotations.media.Schema
import jakarta.validation.constraints.*
import java.time.Instant
import java.util.UUID
import ru.lastochka.common.Metadata

data class UserView(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val id: UUID,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val login: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val name: String,
    @field:Schema(
        requiredMode = Schema.RequiredMode.REQUIRED,
        allowableValues = [Metadata.Identity.ADMIN, Metadata.StaffAccess.STAFF],
    )
    val role: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val mustChangePassword: Boolean,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val expiresAt: Instant?,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val revision: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Назначенные разрешения сотрудника; для ADMIN пустой набор означает полный доступ.") val permissions: Set<String> = emptySet(),
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Версия изменения роли и разрешений.") val accessRevision: Long = 0,
)

data class UserPage(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val items: List<UserView>,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val total: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val page: Int,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val size: Int,
)

// Deliberately not data classes: generated toString must never include credentials.
class CreateUserRequest(
    @field:NotBlank @field:Size(max = Metadata.Limits.MAX_NAME_LENGTH) val name: String,
    @field:NotBlank @field:Size(max = Metadata.Concept.LOGIN_MAX) val login: String,
    @field:Schema(allowableValues = [Metadata.Identity.ADMIN, Metadata.StaffAccess.STAFF]) val role: String = Metadata.Identity.ADMIN,
    @field:Schema(description = "Для STAFF: SCHEDULE_VIEW, SCHEDULE_EDIT, PAYMENT_VIEW, PAYMENT_EDIT, ENQUIRIES_VIEW.") val permissions: Set<String> = emptySet(),
    @field:Schema(
        requiredMode = Schema.RequiredMode.REQUIRED,
        accessMode = Schema.AccessMode.WRITE_ONLY,
    )
    val temporaryPassword: String,
) {
    @com.fasterxml.jackson.annotation.JsonAnySetter
    fun rejectUnknown(name: String, value: Any?) {
        throw ru.lastochka.common.error.FieldValidationException(
            mapOf("request" to Metadata.ErrorCodes.FIELD_INVALID)
        )
    }
}

class UserAccessRequest(
    @field:NotBlank @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = [Metadata.Identity.ADMIN, Metadata.StaffAccess.STAFF]) val role: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Список разрешений STAFF; при изменении автоматически включается соответствующий просмотр. Для ADMIN должен быть пустым.") val permissions: Set<String>,
    @field:NotNull @field:PositiveOrZero @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val revision: Long?,
) {
    @com.fasterxml.jackson.annotation.JsonAnySetter
    fun rejectUnknown(name: String, value: Any?) {
        throw ru.lastochka.common.error.FieldValidationException(
            mapOf("request" to Metadata.ErrorCodes.FIELD_INVALID)
        )
    }
}

data class UserAccessAudit(val role: String, val permissions: Set<String>)

class TemporaryPasswordRequest(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    @field:PositiveOrZero
    val revision: Long,
    @field:Schema(
        requiredMode = Schema.RequiredMode.REQUIRED,
        accessMode = Schema.AccessMode.WRITE_ONLY,
    )
    val temporaryPassword: String,
)

class ChangePasswordRequest(
    @field:Schema(
        requiredMode = Schema.RequiredMode.REQUIRED,
        accessMode = Schema.AccessMode.WRITE_ONLY,
    )
    val currentPassword: String,
    @field:Schema(
        requiredMode = Schema.RequiredMode.REQUIRED,
        accessMode = Schema.AccessMode.WRITE_ONLY,
    )
    val newPassword: String,
    @field:Schema(
        requiredMode = Schema.RequiredMode.REQUIRED,
        accessMode = Schema.AccessMode.WRITE_ONLY,
    )
    val confirmPassword: String,
)
