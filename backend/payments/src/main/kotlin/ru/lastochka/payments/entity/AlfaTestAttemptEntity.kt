package ru.lastochka.payments.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID
import ru.lastochka.common.Metadata

@Entity
@Table(name = "alfa_test_attempts")
class AlfaTestAttemptEntity(
    @Id @Column(name = "payment_id") val paymentId: UUID = UUID.randomUUID(),
    @Column(name = "config_version") val configVersion: UUID = UUID.randomUUID(),
    @Column(name = "order_number") val orderNumber: String = "",
    @Column(name = "order_id") val orderId: String? = null,
    @Column(name = "draft_version") val draftVersion: Long = 0,
    @Column(name = "amount_minor") val amountMinor: Long = 0,
    val currency: String = Metadata.Concept.RUB,
    val purpose: String = "",
    @Column(name = "operation_state") val operationState: String = Metadata.AlfaPayment.STATE_UNKNOWN,
    @Column(name = "bank_status") val bankStatus: String? = null,
    @Column(name = "bank_checked_at") val bankCheckedAt: Instant? = null,
    @Column(name = "bank_error") val bankError: String? = null,
    @Column(name = "link_ciphertext") val linkCiphertext: ByteArray? = null,
    val archived: Boolean = false,
    @Column(name = "rejected_at") val rejectedAt: Instant? = null,
    @Column(name = "cancel_requested") val cancelRequested: Boolean = false,
    @Column(name = "callback_pending") val callbackPending: Boolean = false,
    val revision: Long = 0,
    @Column(name = "lease_until") val leaseUntil: Instant? = null,
    @Column(name = "next_check_at") val nextCheckAt: Instant = Instant.EPOCH,
    @Column(name = "created_at") val createdAt: Instant = Instant.EPOCH,
    @Column(name = "updated_at") val updatedAt: Instant = Instant.EPOCH,
)
