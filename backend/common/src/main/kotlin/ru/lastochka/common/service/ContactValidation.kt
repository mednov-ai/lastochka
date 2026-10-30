package ru.lastochka.common.service

import ru.lastochka.common.Metadata
import ru.lastochka.common.error.FieldValidationException

object ContactValidation {
    fun name(value: String, field: String): String {
        val result = value.trim()
        if (result.isBlank())
            throw FieldValidationException(mapOf(field to Metadata.ErrorCodes.FIELD_REQUIRED))
        if (result.length > Metadata.Concept.MAX_NAME)
            throw FieldValidationException(mapOf(field to Metadata.ErrorCodes.FIELD_LENGTH))
        return result
    }

    fun phone(value: String): String {
        val digits = value.filter { it in '0'..'9' }
        if (
            digits.length != Metadata.Concept.PHONE_DIGITS ||
                (digits.firstOrNull() != '7' && digits.firstOrNull() != '8') ||
                value.any { it !in '0'..'9' && it !in "+()- " }
        )
            throw FieldValidationException(mapOf("phone" to Metadata.Concept.FIELD_PHONE))
        return "+7" + digits.drop(1)
    }
}
