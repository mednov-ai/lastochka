package ru.lastochka.common.error

import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.web.bind.MethodArgumentNotValidException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice
import org.springframework.web.server.ResponseStatusException
import org.springframework.web.servlet.resource.NoResourceFoundException
import ru.lastochka.common.Metadata
import ru.lastochka.common.dto.ApiError

@RestControllerAdvice
class ApiExceptionHandler(private val errors: ApiErrorFactory) {
    @ExceptionHandler(ResponseStatusException::class)
    fun status(e: ResponseStatusException): ResponseEntity<ApiError> =
        errors.response(e.statusCode.value(), e.reason ?: Metadata.ErrorCodes.REQUEST_FAILED)

    @ExceptionHandler(FieldValidationException::class)
    fun fields(e: FieldValidationException): ResponseEntity<ApiError> =
        errors.response(
            Metadata.Http.BAD_REQUEST,
            Metadata.ErrorCodes.VALIDATION_ERROR,
            e.fieldCodes,
        )

    @ExceptionHandler(MethodArgumentNotValidException::class)
    fun invalid(e: MethodArgumentNotValidException): ResponseEntity<ApiError> =
        errors.response(
            Metadata.Http.BAD_REQUEST,
            Metadata.ErrorCodes.VALIDATION_ERROR,
            e.bindingResult.fieldErrors
                .groupBy { it.field }
                .mapValues { (field, failures) ->
                    val constraintCode = failures.firstNotNullOfOrNull { failure ->
                        try {
                            failure
                                .unwrap(jakarta.validation.ConstraintViolation::class.java)
                                .messageTemplate
                                .removeSurrounding("{", "}")
                                .takeIf(errors.messages::known)
                        } catch (_: IllegalArgumentException) {
                            null
                        }
                    }
                    constraintCode
                        ?: when {
                            failures.any { it.code in setOf("NotBlank", "NotNull", "NotEmpty") } ->
                                Metadata.ErrorCodes.FIELD_REQUIRED
                            failures.any { it.code == "Email" } -> Metadata.ErrorCodes.FIELD_EMAIL
                            failures.any { it.code == "Size" } -> Metadata.ErrorCodes.FIELD_LENGTH
                            else -> Metadata.ErrorCodes.FIELD_INVALID
                        }
                },
        )

    @ExceptionHandler(
        HttpMessageNotReadableException::class,
        IllegalArgumentException::class,
        org.springframework.web.bind.MissingServletRequestParameterException::class,
        org.springframework.web.bind.MissingRequestHeaderException::class,
        org.springframework.web.method.annotation.MethodArgumentTypeMismatchException::class,
        org.springframework.web.method.annotation.HandlerMethodValidationException::class,
        jakarta.validation.ConstraintViolationException::class,
    )
    fun malformed(): ResponseEntity<ApiError> =
        errors.response(Metadata.Http.BAD_REQUEST, Metadata.ErrorCodes.VALIDATION_ERROR)

    @ExceptionHandler(NoResourceFoundException::class)
    fun missing(): ResponseEntity<ApiError> =
        errors.response(Metadata.Http.NOT_FOUND, Metadata.ErrorCodes.NOT_FOUND)

    @ExceptionHandler(DataIntegrityViolationException::class)
    fun conflict(): ResponseEntity<ApiError> =
        errors.response(Metadata.Http.CONFLICT, Metadata.ErrorCodes.DATA_CONFLICT)

    @ExceptionHandler(org.springframework.dao.OptimisticLockingFailureException::class)
    fun version(): ResponseEntity<ApiError> =
        errors.response(Metadata.Http.CONFLICT, Metadata.ErrorCodes.VERSION_CONFLICT)

    @ExceptionHandler(org.springframework.web.HttpRequestMethodNotSupportedException::class)
    fun method(): ResponseEntity<ApiError> =
        errors.response(Metadata.Http.METHOD_NOT_ALLOWED, Metadata.ErrorCodes.METHOD_NOT_ALLOWED)

    @ExceptionHandler(Exception::class)
    fun unexpected(e: Exception): ResponseEntity<ApiError> {
        val result =
            errors.response(Metadata.Http.INTERNAL_ERROR, Metadata.ErrorCodes.INTERNAL_ERROR)
        // Never log the throwable, its message, rejected values or request body.
        org.slf4j.LoggerFactory.getLogger(javaClass)
            .error(
                "Unexpected request failure code=INTERNAL_ERROR requestId={} class={} location={}",
                result.body?.requestId,
                e.javaClass.name,
                e.stackTrace.firstOrNull(),
            )
        return result
    }
}
