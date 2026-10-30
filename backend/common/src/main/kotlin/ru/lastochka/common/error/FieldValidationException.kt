package ru.lastochka.common.error

open class FieldValidationException(val fieldCodes: Map<String, String>) :
    RuntimeException("Field validation rejected")
