package ru.lastochka.common.error

import java.util.UUID
import org.springframework.beans.factory.annotation.Value
import org.springframework.http.ResponseEntity
import org.springframework.stereotype.Component
import ru.lastochka.common.Metadata
import ru.lastochka.common.dto.ApiError

@Component
class ApiErrorFactory(
    val messages: MessageProvider,
    @Value(Metadata.Configuration.LASTOCHKA_SECURITY_RATE_WINDOW_SECONDS)
    private val rateWindowSeconds: Long,
) {
    fun body(status: Int, code: String?, fieldCodes: Map<String, String> = emptyMap()): ApiError =
        ApiError(
            title = messages.text(Metadata.ErrorCodes.ERROR_TITLE),
            status = status,
            code =
                if (messages.known(code)) requireNotNull(code)
                else Metadata.ErrorCodes.REQUEST_FAILED,
            detail = messages.text(code ?: Metadata.ErrorCodes.REQUEST_FAILED),
            requestId = UUID.randomUUID().toString(),
            fieldErrors =
                fieldCodes
                    .filterKeys { it.matches(Regex(Metadata.ErrorCodes.FIELD_PATTERN)) }
                    .mapValues { messages.text(it.value) },
        )

    fun response(
        status: Int,
        code: String?,
        fields: Map<String, String> = emptyMap(),
    ): ResponseEntity<ApiError> {
        val builder =
            ResponseEntity.status(status)
                .header(Metadata.Protocol.CONTENT_TYPE, Metadata.Protocol.PROBLEM_JSON)
        if (status == Metadata.Http.TOO_MANY_REQUESTS)
            builder.header(Metadata.Protocol.RETRY_AFTER, rateWindowSeconds.toString())
        return builder.body(body(status, code, fields))
    }
}
