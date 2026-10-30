package ru.lastochka.notifications.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table

@Entity
@Table(name = "enquiry_notification_settings")
class NotificationSettingsEntity(
    @Id val id: Int = 0,
    @Column(name = "telegram_enabled") val telegramEnabled: Boolean = true,
    @Column(name = "browser_push_enabled") val browserPushEnabled: Boolean = false,
    val version: Long = 0,
)
