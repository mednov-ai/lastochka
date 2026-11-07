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
    @field:Schema(nullable = true) val operationState: String? = null,
    @field:Schema(nullable = true) val bankStatus: String? = null,
    @field:Schema(nullable = true) val bankCheckedAt: Instant? = null,
    @field:Schema(nullable = true) val bankError: String? = null,
    @field:Schema(nullable = true) val snapshotAmountMinor: Long? = null,
    @field:Schema(nullable = true) val snapshotPurpose: String? = null,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val archived: Boolean = false,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val canRefresh: Boolean = false,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val canCancel: Boolean = false,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val canArchive: Boolean = false,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val linkAvailable: Boolean = false,
)

data class PaymentCommand(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val expectedVersion: Long,
)

data class PaymentLink(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val url: String,
)

data class PaymentPage(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val items: List<PaymentView>,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED) val total: Long,
)
