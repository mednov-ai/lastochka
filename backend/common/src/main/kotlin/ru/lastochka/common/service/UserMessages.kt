package ru.lastochka.common.service

import java.util.Locale
import org.springframework.context.support.ResourceBundleMessageSource
import org.springframework.stereotype.Component

/** Тексты результатов действий и писем. Общая фабрика ошибок использует свой строгий каталог. */
@Component
class UserMessages {
    private val source =
        ResourceBundleMessageSource().apply {
            setBasename("user-messages")
            setDefaultEncoding("UTF-8")
        }

    fun render(key: String, vararg arguments: Any?): String =
        source.getMessage(
            key,
            arguments.map { it ?: "" }.toTypedArray(),
            Locale.forLanguageTag("ru"),
        )
}
