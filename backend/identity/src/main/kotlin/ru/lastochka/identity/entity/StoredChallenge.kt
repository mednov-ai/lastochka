package ru.lastochka.identity.entity

import jakarta.persistence.Column
import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "webauthn_challenges")
class StoredChallenge(
    @Id @Column(name = "session_id") val sessionId: String = "",
    @Column(name = "account_id") val accountId: UUID = UUID(0, 0),
    val kind: String = "",
    val payload: String = "",
    @Column(name = "expires_at") val expiresAt: Instant = Instant.EPOCH,
)
