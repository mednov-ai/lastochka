package ru.lastochka.notifications.entity

import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID
import ru.lastochka.common.Metadata

@Entity
@Table(name = "vk_enquiry_outbox")
class VkOutboxEntity(
    @Id val enquiryId: UUID,
    val destinationId: UUID,
    val enquiryNumber: Long,
    val randomId: Int,
    var status: String = Metadata.Concept.PENDING,
    var attempts: Int = 0,
    var nextAttemptAt: Instant = Instant.now(),
    var leaseUntil: Instant? = null,
    var messageId: Long? = null,
    var lastError: String? = null,
    val createdAt: Instant = Instant.now(),
)
