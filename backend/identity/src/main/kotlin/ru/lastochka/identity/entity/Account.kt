package ru.lastochka.identity.entity

import jakarta.persistence.*
import java.time.Instant
import java.util.UUID
import ru.lastochka.common.Metadata

@Entity
@Table(name = "accounts")
class Account(
    @Id val id: UUID = UUID.randomUUID(),
    @Column(nullable = false, unique = true) val email: String,
    @Column(nullable = false) var name: String,
    @Column(name = "password_hash", nullable = false) var passwordHash: String,
    @Column(nullable = false) var role: String = Metadata.Identity.PARENT,
    @Column(name = "additional_role") val additionalRole: String? = null,
    @Column(unique = true) var login: String? = null,
    @Column(name = "admin_enabled", nullable = false) var adminEnabled: Boolean = false,
    @Column(name = "auth_version") var authVersion: Long = 0,
    @Column(name = "permission_revision", nullable = false) var permissionRevision: Long = 0,
    @Column(name = "verified_at") var verifiedAt: Instant? = null,
    @Column(name = "must_change_password", nullable = false)
    var mustChangePassword: Boolean = false,
    @Column(name = "temporary_password_expires_at") var temporaryPasswordExpiresAt: Instant? = null,
    @Column(name = "created_at", nullable = false) val createdAt: Instant = Instant.now(),
) {
    fun roleNames(): List<String> = listOf(role)
}
