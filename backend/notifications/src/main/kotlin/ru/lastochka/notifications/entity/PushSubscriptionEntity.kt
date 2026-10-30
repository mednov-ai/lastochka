package ru.lastochka.notifications.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.util.UUID

@Entity
@Table(name = "browser_push_subscriptions")
class PushSubscriptionEntity(
    @Id val id: UUID = UUID.randomUUID(),
    @Column(name = "account_id") val accountId: UUID = UUID.randomUUID(),
    @Column(name = "auth_version") val authVersion: Long = 0,
    @Column(name = "generation_hash") val generationHash: String = "",
    val active: Boolean = true,
)
