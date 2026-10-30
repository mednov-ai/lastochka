package ru.lastochka.notifications.dto

import io.swagger.v3.oas.annotations.media.Schema
import java.util.UUID

data class PushSubscriptionInput(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val endpoint: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val p256dh: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val auth: String,
) {
    override fun toString(): String = "PushSubscriptionInput(redacted)"
}

data class PushSubscriptionView(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val id: UUID
)

data class PushConfigurationView(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val configured: Boolean,
    @field:Schema(nullable = true) val publicKey: String?,
)

data class PushSubscriptionStatus(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val active: Boolean
)
