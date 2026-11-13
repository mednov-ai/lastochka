package ru.lastochka.payments.entity

import ru.lastochka.common.Metadata
import jakarta.persistence.*
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "alfa_configuration")
class AlfaConfigurationEntity(
    @Id val id: Int = 1,
    @Column(nullable = false) val environment: String = Metadata.AlfaConnection.TEST_ENVIRONMENT,
    var enabled: Boolean = false,
    var revision: Long = 0,
    @Column(name = "current_key_id") var currentKeyId: String? = null,
    @Column(name = "active_version") var activeVersion: UUID? = null,
    @Column(name = "candidate_version") var candidateVersion: UUID? = null,
    @Column(name = "updated_at") var updatedAt: Instant? = null,
    @Column(name = "updated_by") var updatedBy: UUID? = null,
)

@Entity
@Table(name = "alfa_credentials_versions")
class AlfaCredentialsEntity(
    @Id val id: UUID,
    @Column(nullable = false) var ciphertext: ByteArray,
    @Column(name = "created_at", nullable = false) val createdAt: Instant,
    @Column(name = "created_by", nullable = false) val createdBy: UUID,
    @Column(nullable = false) val environment: String = Metadata.AlfaConnection.TEST_ENVIRONMENT,
)
