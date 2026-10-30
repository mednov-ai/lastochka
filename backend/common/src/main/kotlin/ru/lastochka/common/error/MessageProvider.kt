package ru.lastochka.common.error

import java.util.Locale
import org.springframework.context.MessageSource
import org.springframework.stereotype.Component
import ru.lastochka.common.Metadata

@Component
class MessageProvider(private val source: MessageSource) {
    // Only catalogued codes and numeric formatting arguments. Never interpolate request values.
    fun known(code: String?): Boolean =
        code != null &&
            code.matches(Regex(Metadata.ErrorCodes.CODE_PATTERN)) &&
            source.getMessage(code, null, null, Locale.forLanguageTag("ru")) != null

    fun text(code: String, vararg args: Number): String =
        source.getMessage(
            if (known(code)) code else Metadata.ErrorCodes.REQUEST_FAILED,
            args,
            Locale.forLanguageTag("ru"),
        )
}
