package ru.lastochka.payments.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "payment_requests")
class PaymentEntity(
    @Id val id: UUID = UUID.randomUUID(),
    @Column(name = "amount_minor") val amountMinor: Long = 0,
    val purpose: String = "",
    @Column(name = "recipient_name") val recipientName: String = "",
    val phone: String = "",
    @Column(name = "enquiry_id") val enquiryId: UUID? = null,
    val version: Long = 0,
    @Column(name = "created_at") val createdAt: Instant = Instant.EPOCH,
)
