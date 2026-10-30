package ru.lastochka.identity.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant

@Entity
@Table(name = "auth_limits")
class AuthLimit(
    @Id val bucket: String = "",
    val attempts: Int = 0,
    @Column(name = "resets_at") val resetsAt: Instant = Instant.EPOCH,
)
