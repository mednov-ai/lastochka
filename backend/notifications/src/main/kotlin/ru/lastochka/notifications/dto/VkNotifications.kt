package ru.lastochka.notifications.dto

import com.fasterxml.jackson.annotation.JsonProperty
import io.swagger.v3.oas.annotations.media.Schema
import java.time.Instant
import java.util.UUID

data class VkChat(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val id: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val title: String,
)

data class VkKeyInput(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val version: Long,
    @field:Schema(
        accessMode = Schema.AccessMode.WRITE_ONLY,
        requiredMode = Schema.RequiredMode.REQUIRED,
    )
    @param:JsonProperty(access = JsonProperty.Access.WRITE_ONLY)
    val key: String,
) {
    override fun toString(): String = "VkKeyInput(version=$version)"
}

data class VkChatInput(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val version: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val chatId: Long,
)

data class VkVersionInput(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val version: Long
)

data class VkToggleInput(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val version: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val enabled: Boolean,
)

data class VkSettingsView(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val version: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val enabled: Boolean,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val storageReady: Boolean,
    val activeChat: VkChat?,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val draftHasKey: Boolean,
    val draftChat: VkChat?,
    val testStatus: String?,
    val error: String?,
)

data class VkDeliveryView(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val status: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val attempts: Int,
    val error: String?,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val canRetry: Boolean,
)

data class VkDeliveryAttempt(
    val id: UUID,
    val destination: UUID,
    val number: Long,
    val randomId: Int,
    val attempt: Int,
    val lease: Instant,
)

data class VkSendResult(
    val messageId: Long? = null,
    val error: String? = null,
    val temporary: Boolean = false,
)
