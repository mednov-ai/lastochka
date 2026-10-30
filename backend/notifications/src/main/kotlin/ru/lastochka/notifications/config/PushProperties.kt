package ru.lastochka.notifications.config

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Configuration
import ru.lastochka.common.Metadata

@ConfigurationProperties(Metadata.BrowserPush.CONFIG)
data class PushProperties(
    val publicKey: String = "",
    val privateKey: String = "",
    val subject: String = "",
) {
    fun configured(): Boolean = publicKey.isNotBlank() && privateKey.isNotBlank()

    override fun toString(): String = "PushProperties(configured=${configured()})"
}

@Configuration @EnableConfigurationProperties(PushProperties::class) class PushConfiguration
