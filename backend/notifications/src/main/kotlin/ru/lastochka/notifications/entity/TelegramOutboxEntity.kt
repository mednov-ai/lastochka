package ru.lastochka.notifications.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.util.UUID

@Entity
@Table(name = "telegram_outbox")
class TelegramOutboxEntity(
    @Id @Column(name = "enquiry_id") val enquiryId: UUID = UUID.randomUUID(),
    val status: String = "",
    val attempts: Int = 0,
    @Column(name = "last_error") val lastError: String? = null,
)
