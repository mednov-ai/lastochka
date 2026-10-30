package ru.lastochka.common.error

import org.springframework.http.HttpStatus
import org.springframework.web.server.ResponseStatusException

// Keep the existing exception/status contract while making guards read as a single step.
fun badRequest(code: String): Nothing = throw ResponseStatusException(HttpStatus.BAD_REQUEST, code)

fun conflict(code: String): Nothing = throw ResponseStatusException(HttpStatus.CONFLICT, code)

fun notFound(code: String): Nothing = throw ResponseStatusException(HttpStatus.NOT_FOUND, code)

fun unauthorized(code: String): Nothing =
    throw ResponseStatusException(HttpStatus.UNAUTHORIZED, code)

fun forbidden(code: String): Nothing = throw ResponseStatusException(HttpStatus.FORBIDDEN, code)
