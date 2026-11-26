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
    private data class Link(val code: VkLinkCode, val actor: UUID, val version: Long)

    private var pending: Link? = null

    fun available(): Boolean = group > 0 && secret.isNotBlank() && confirmation.isNotBlank()

    @Synchronized
    fun start(version: Long, actor: UUID): VkLinkCode {
        if (!available() || !settings.draftBelongsTo(version, group)) conflict(Metadata.Vk.NOT_READY)
        val code = VkLinkCode("lastochka-" + UUID.randomUUID(), clock.instant().plusSeconds(Metadata.Vk.LINK_SECONDS))
        pending = Link(code, actor, version)
        return code
    }

    fun receive(event: JsonNode): String? {
        if (!available() || event.path("group_id").asLong() != group) return null
        if (event.path("type").asString() == "confirmation") return confirmation
        val provided = event.path("secret").asString()
        if (!MessageDigest.isEqual(provided.toByteArray(Charsets.UTF_8), secret.toByteArray(Charsets.UTF_8))) return null
        if (event.path("type").asString() == "message_new") {
            val message = event.path("object").path("message")
            match(message.path("peer_id").asLong(), message.path("text").asString())
        }
        return "ok"
    }

    @Synchronized
    private fun match(peer: Long, text: String) {
        val link = pending ?: return
        if (peer <= Metadata.Vk.GROUP_PEER_BASE || !clock.instant().isBefore(link.code.expiresAt)) return
        val body = text.replace(Regex("\\[club$group\\|[^\\]\\n]{1,100}\\]"), "").trim()
        if (body != link.code.code) return
        val chat = settings.verifyLinkedChat(link.version, group, peer) ?: return
        if (!clock.instant().isBefore(link.code.expiresAt)) return
        settings.linkDraft(link.version, group, chat, link.actor)
        pending = null
    }
}
