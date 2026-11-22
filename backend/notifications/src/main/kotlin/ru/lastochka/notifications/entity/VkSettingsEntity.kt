package ru.lastochka.notifications.entity

import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import java.time.Instant
import java.util.UUID

@Entity
@Table(name = "vk_enquiry_settings")
class VkSettingsEntity(
    @Id val id: Int = 1,
    var version: Long = 0,
    var enabled: Boolean = false,
    var activeToken: ByteArray? = null,
    var activeGroup: Long? = null,
    var activePeer: Long? = null,
    var activeTitle: String? = null,
    var destinationId: UUID? = null,
    var draftToken: ByteArray? = null,
    var draftGroup: Long? = null,
    var draftPeer: Long? = null,
    var draftTitle: String? = null,
    var testStatus: String? = null,
    var testError: String? = null,
    var testStarted: Instant? = null,
    var testRandomId: Int? = null,
)
