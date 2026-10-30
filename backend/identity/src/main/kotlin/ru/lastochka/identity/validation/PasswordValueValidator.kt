package ru.lastochka.identity.validation

import jakarta.validation.ConstraintValidator
import jakarta.validation.ConstraintValidatorContext

class PasswordValueValidator : ConstraintValidator<PasswordValue, String> {
    private var newValue = true

    override fun initialize(annotation: PasswordValue) {
        newValue = annotation.newValue
    }

    override fun isValid(value: String?, context: ConstraintValidatorContext): Boolean {
        val code = PasswordPolicy.failure(value, newValue) ?: return true
        context.disableDefaultConstraintViolation()
        context.buildConstraintViolationWithTemplate("{$code}").addConstraintViolation()
        return false
    }
}
