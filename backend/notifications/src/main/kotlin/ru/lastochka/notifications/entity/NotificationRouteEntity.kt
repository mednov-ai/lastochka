package ru.lastochka.notifications.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.util.UUID

@Entity
@Table(name = "enquiry_notification_routes")
class NotificationRouteEntity(
    @Id @Column(name = "enquiry_id") val enquiryId: UUID = UUID.randomUUID(),
    @Column(name = "telegram_enabled") val telegramEnabled: Boolean = false,
    @Column(name = "browser_push_enabled") val browserPushEnabled: Boolean = false,
    @Column(name = "push_subscriptions") val pushSubscriptions: Int = 0,
)
