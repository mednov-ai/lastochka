package ru.lastochka.notifications.service

import java.security.MessageDigest
import java.time.Clock
import java.util.UUID
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.conflict
import ru.lastochka.notifications.dto.VkLinkCode
import tools.jackson.databind.JsonNode

@Service
class VkChatLinkService(
    private val settings: VkSettingsService,
    private val clock: Clock,
    @Value(Metadata.Vk.CALLBACK_SECRET) private val secret: String,
    @Value(Metadata.Vk.CALLBACK_CONFIRM) private val confirmation: String,
    @Value(Metadata.Vk.CALLBACK_GROUP) private val group: Long,
) {
    private data class Link(val code: VkLinkCode, val actor: UUID, val version: Long, val community: Long)

    private var pending: Link? = null

    private fun legacyAvailable() = group > 0 && secret.isNotBlank() && confirmation.isNotBlank()

    fun available(version: Long): Boolean =
        settings.selectedCommunity(version)?.let(::availableFor) == true

    private fun availableFor(community: Long): Boolean =
        (community == group && legacyAvailable()) || settings.hasManagedCallback(community)

    @Synchronized
    fun start(version: Long, actor: UUID): VkLinkCode {
        val community = settings.selectedCommunity(version) ?: conflict(Metadata.Vk.NOT_READY)
        if (!availableFor(community)) conflict(Metadata.Vk.NOT_READY)
        val code = VkLinkCode("lastochka-" + UUID.randomUUID(), clock.instant().plusSeconds(Metadata.Vk.LINK_SECONDS))
        pending = Link(code, actor, version, community)
        return code
    }

    fun receive(event: JsonNode, callbackId: UUID? = null): String? {
        val community = event.path("group_id").asLong()
        val eventType = event.path("type").asString()
        val confirming = eventType == "confirmation"
        val provided = event.path("secret").asString()
        val reply = if (callbackId != null) {
            settings.callbackConfirmation(callbackId, community, provided, confirming) ?: return null
        } else {
            if (!legacyAvailable() || community != group) return null
            if (!confirming && !MessageDigest.isEqual(
                    provided.toByteArray(Charsets.UTF_8),
                    secret.toByteArray(Charsets.UTF_8),
                )) return null
            confirmation
        }
        if (confirming) return reply
        if (eventType == "message_new") {
            val message = event.path("object").path("message")
            match(community, message.path("peer_id").asLong(), message.path("text").asString())
        }
        return "ok"
    }

    @Synchronized
    private fun match(community: Long, peer: Long, text: String) {
        val link = pending ?: return
        if (link.community != community) return
        if (peer <= Metadata.Vk.GROUP_PEER_BASE || !clock.instant().isBefore(link.code.expiresAt)) return
        val body = text.replace(Regex("\\[club$community\\|[^\\]\\n]{1,100}\\]"), "").trim()
        if (body != link.code.code) return
        val chat = settings.verifyLinkedChat(link.version, community, peer) ?: return
        if (!clock.instant().isBefore(link.code.expiresAt)) return
        settings.linkDraft(link.version, community, chat, link.actor)
        pending = null
    }
}
