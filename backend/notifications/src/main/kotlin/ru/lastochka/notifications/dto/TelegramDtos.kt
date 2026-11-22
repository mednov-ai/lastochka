package ru.lastochka.notifications.dto

import io.swagger.v3.oas.annotations.media.Schema

data class DeliveryView(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val status: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val attempts: Int,
    @field:Schema(nullable = true) val error: String?,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val configured: Boolean,
)
