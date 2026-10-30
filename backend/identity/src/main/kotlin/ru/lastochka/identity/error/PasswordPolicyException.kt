package ru.lastochka.identity.error

import ru.lastochka.common.Metadata
import ru.lastochka.common.error.FieldValidationException

class PasswordPolicyException(val code: String) :
    FieldValidationException(mapOf(Metadata.Fields.PASSWORD to code))
