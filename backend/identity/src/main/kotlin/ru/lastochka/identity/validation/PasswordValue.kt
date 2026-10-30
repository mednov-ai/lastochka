package ru.lastochka.identity.validation

import jakarta.validation.Constraint
import jakarta.validation.Payload
import kotlin.reflect.KClass
import ru.lastochka.common.Metadata

@Target(AnnotationTarget.FIELD, AnnotationTarget.VALUE_PARAMETER)
@Retention(AnnotationRetention.RUNTIME)
@Constraint(validatedBy = [PasswordValueValidator::class])
annotation class PasswordValue(
    val newValue: Boolean = true,
    val message: String = Metadata.Password.CONSTRAINT_MESSAGE,
    val groups: Array<KClass<*>> = [],
    val payload: Array<KClass<out Payload>> = [],
)
