package ru.lastochka.identity.validation

import ru.lastochka.common.Metadata
import ru.lastochka.identity.error.PasswordPolicyException

object PasswordPolicy {
    fun failure(value: String?, newValue: Boolean = true): String? {
        if (value == null) return Metadata.ErrorCodes.FIELD_REQUIRED
        val points = value.codePoints().toArray()
        if (points.any { it in 0xD800..0xDFFF })
            return Metadata.ErrorCodes.PASSWORD_INVALID_CHARACTERS
        if (!newValue && points.isEmpty()) return Metadata.ErrorCodes.FIELD_REQUIRED
        if (points.size < if (newValue) Metadata.Password.MIN_CODE_POINTS else 1)
            return Metadata.ErrorCodes.PASSWORD_TOO_SHORT
        if (points.size > Metadata.Password.MAX_CODE_POINTS)
            return Metadata.ErrorCodes.PASSWORD_TOO_LONG
        if (newValue && points.none { Character.isLetter(it) })
            return Metadata.ErrorCodes.PASSWORD_LETTER_REQUIRED
        if (newValue && points.none { Character.isDigit(it) })
            return Metadata.ErrorCodes.PASSWORD_DIGIT_REQUIRED
        return null
    }

    fun requireNew(value: String) {
        failure(value)?.let { throw PasswordPolicyException(it) }
    }
}
