package ru.lastochka.identity.dto

import io.swagger.v3.oas.annotations.media.Schema
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.FieldValidationException
import ru.lastochka.identity.validation.PasswordValue

class ConfirmPasswordRequest(
    @field:PasswordValue(newValue = false)
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED, accessMode = Schema.AccessMode.WRITE_ONLY)
    val password: String,
) {
    @com.fasterxml.jackson.annotation.JsonAnySetter
    fun rejectUnknown(name: String, value: Any?) {
        throw FieldValidationException(mapOf("request" to Metadata.ErrorCodes.FIELD_INVALID))
    }
}

data class PasswordConfirmationView(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val fresh: Boolean,
)
