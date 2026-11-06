package ru.lastochka.identity.entity

import jakarta.persistence.Column
import jakarta.persistence.Embeddable
import jakarta.persistence.EmbeddedId
import jakarta.persistence.Entity
import jakarta.persistence.Table
import java.io.Serializable
import java.util.UUID

@Embeddable
data class StaffPermissionId(
    @Column(name = "account_id") val accountId: UUID = UUID.randomUUID(),
    @Column(name = "permission") val permission: String = "",
) : Serializable

@Entity
@Table(name = "staff_permissions")
class StaffPermission(@EmbeddedId val id: StaffPermissionId = StaffPermissionId())
