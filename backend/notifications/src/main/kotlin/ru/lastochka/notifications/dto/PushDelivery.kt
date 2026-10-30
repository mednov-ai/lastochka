package ru.lastochka.notifications.dto

import java.util.UUID

data class PushDelivery(
    val enquiryId: UUID,
    val subscriptionId: UUID,
    val accountId: UUID,
    val authVersion: Long,
    val endpoint: String,
    val p256dh: String,
    val auth: String,
    val number: Long,
    val attempts: Int,
) {
    override fun toString(): String =
        "PushDelivery(enquiryId=$enquiryId, subscriptionId=$subscriptionId, attempts=$attempts)"
}
