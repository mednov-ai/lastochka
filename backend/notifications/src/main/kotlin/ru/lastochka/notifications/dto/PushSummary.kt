package ru.lastochka.notifications.dto

import io.swagger.v3.oas.annotations.media.Schema

data class PushSummary(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val selected: Boolean,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val configured: Boolean,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val subscriptions: Int,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val waiting: Int,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val accepted: Int,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val failed: Int,
)
