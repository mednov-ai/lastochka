package ru.lastochka.notifications.config

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Configuration
import ru.lastochka.common.Metadata

@ConfigurationProperties(Metadata.Concept.TELEGRAM_CONFIG)
data class TelegramProperties(
    val token: String = "",
    val chatId: String = "",
    val apiUrl: String = Metadata.Concept.TELEGRAM_URL,
) {
    override fun toString(): String =
        "TelegramProperties(configured=${token.isNotBlank() && chatId.isNotBlank()})"
}

@Configuration @EnableConfigurationProperties(TelegramProperties::class) class TelegramConfiguration
