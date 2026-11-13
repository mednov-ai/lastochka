package ru.lastochka.payments.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "alfa_gateway_selection")
class AlfaGatewaySelectionEntity(
    @Id val id: Int = 1,
    @Column(name = "active_environment") var activeEnvironment: String? = null,
    var revision: Long = 0,
    @Column(name = "updated_at") var updatedAt: Instant? = null,
    @Column(name = "updated_by") var updatedBy: UUID? = null,
)
