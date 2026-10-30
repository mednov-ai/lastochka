package ru.lastochka.payments.dto

import io.swagger.v3.oas.annotations.media.Schema
import java.time.Instant
import java.util.UUID
import ru.lastochka.common.Metadata

data class PaymentInput(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val amountMinor: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val purpose: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val recipientName: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val phone: String,
    @field:Schema(nullable = true) val enquiryId: UUID? = null,
    @field:Schema(nullable = true) val expectedVersion: Long? = null,
)

data class PaymentView(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val id: UUID,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val amountMinor: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val purpose: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val recipientName: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val phone: String,
    @field:Schema(nullable = true) val enquiryId: UUID?,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val version: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val createdAt: Instant,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val status: String = Metadata.Concept.DRAFT,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val currency: String = Metadata.Concept.RUB,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val paymentLinkIssuanceAvailable: Boolean = false,
)

data class PaymentPage(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val items: List<PaymentView>,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val total: Long,
)
