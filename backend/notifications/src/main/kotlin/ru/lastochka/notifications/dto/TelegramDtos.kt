package ru.lastochka.notifications.dto

import io.swagger.v3.oas.annotations.media.Schema
import java.util.UUID

data class TelegramItem(val enquiryId: UUID, val body: String, val attempts: Int)

data class DeliveryView(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val status: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val attempts: Int,
    @field:Schema(nullable = true) val error: String?,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val configured: Boolean,
)

data class TelegramResult(
    val messageId: Long? = null,
    val retrySeconds: Long? = null,
    val permanent: Boolean = false,
    val chatMigrated: Boolean = false,
)
