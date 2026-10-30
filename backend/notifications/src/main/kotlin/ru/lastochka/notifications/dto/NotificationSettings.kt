package ru.lastochka.notifications.dto

import io.swagger.v3.oas.annotations.media.Schema

data class NotificationSettings(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val telegramEnabled: Boolean,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val browserPushEnabled: Boolean,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val version: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val telegramConfigured: Boolean = false,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val pushConfigured: Boolean = false,
)
