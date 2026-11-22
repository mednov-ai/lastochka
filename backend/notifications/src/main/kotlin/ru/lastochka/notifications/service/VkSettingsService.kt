package ru.lastochka.notifications.service

import java.time.Instant
import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.badRequest
import ru.lastochka.common.error.conflict
import ru.lastochka.common.error.unavailable
import ru.lastochka.common.service.CommandService
import ru.lastochka.common.service.UserMessages
import ru.lastochka.notifications.dto.VkChat
import ru.lastochka.notifications.dto.VkSettingsView
import ru.lastochka.notifications.entity.VkSettingsEntity
import ru.lastochka.notifications.repo.VkSettingsRepository

@Service
class VkSettingsService(
    private val settings: VkSettingsRepository,
    private val box: VkSecretBox,
    private val api: VkApiClient,
    private val transactions: TransactionTemplate,
    private val audit: CommandService,
    private val texts: UserMessages,
) {
    fun get(): VkSettingsView = view(settings.current())

    fun saveKey(version: Long, value: String, actor: UUID): VkSettingsView {
        val key = value.trim()
        if (
            key.isEmpty() ||
                key.length > Metadata.Vk.MAX_TOKEN_LENGTH ||
                key.any { it.isWhitespace() }
        )
            badRequest(Metadata.Vk.BAD_KEY)
        val sealed =
            runCatching { box.seal(key) }.getOrElse { unavailable(Metadata.Vk.KEY_STORAGE) }
        requireVersion(settings.current(), version)
        val group = vkRequest { api.community(key) }
        return change(version) {
            draftToken = sealed
            draftGroup = group
            draftPeer = null
            draftTitle = null
            clearTest()
            audit.audit(actor, actor, Metadata.Vk.SAVED_KEY, null, group)
        }
    }

    fun chats(version: Long): List<VkChat> {
        val current = settings.current()
        requireVersion(current, version)
        val key = open(current.draftToken ?: current.activeToken)
        return vkRequest { api.conversations(key) }
    }

    fun choose(version: Long, chatId: Long, actor: UUID): VkSettingsView {
        val chat =
            chats(version).firstOrNull { it.id == chatId }
                ?: badRequest(Metadata.Vk.CHAT_UNAVAILABLE)
        return change(version) {
            draftToken = draftToken ?: activeToken
            draftGroup = draftGroup ?: activeGroup
            draftPeer = chat.id
            draftTitle = chat.title
            clearTest()
            audit.audit(actor, actor, Metadata.Vk.SELECTED_CHAT, null, chat.id)
        }
    }

    fun test(version: Long, actor: UUID): VkSettingsView {
        val claim =
            requireNotNull(
                transactions.execute {
                    val row = settings.locked()
                    requireVersion(row, version)
                    if (row.runningTest()) conflict(Metadata.Vk.LIMITED)
                    val key = open(row.draftToken)
                    val peer = row.draftPeer ?: conflict(Metadata.Vk.NOT_READY)
                    val randomId = row.testRandomId ?: box.randomId(settings.nextRandomId())
                    row.testRandomId = randomId
                    row.testStatus = Metadata.Vk.SENDING
                    row.testError = null
                    row.testStarted = Instant.now()
                    row.version++
                    TestClaim(row.version, key, peer, randomId)
                }
            )
        val sent =
            api.send(claim.key, claim.peer, claim.randomId, texts.render(Metadata.Vk.TEST_MESSAGE))
        return change(claim.version) {
            testStatus =
                if (sent.messageId != null) Metadata.Vk.VERIFIED else Metadata.Concept.FAILED
            testError = sent.error
            testStarted = null
            if (!sent.temporary) testRandomId = null
            if (sent.messageId != null)
                audit.audit(actor, actor, Metadata.Vk.TESTED, null, claim.peer)
        }
    }

    fun toggle(version: Long, enabled: Boolean, actor: UUID): VkSettingsView =
        change(version) {
            val previous = activePeer
            if (enabled && draftToken != null) {
                if (testStatus != Metadata.Vk.VERIFIED) conflict(Metadata.Vk.NOT_READY)
                open(draftToken)
                if (destinationId == null || activeGroup != draftGroup || activePeer != draftPeer)
                    destinationId = UUID.randomUUID()
                activeToken = draftToken
                activeGroup = draftGroup
                activePeer = draftPeer
                activeTitle = draftTitle
                draftToken = null
                draftGroup = null
                draftPeer = null
                draftTitle = null
                clearTest()
            }
            if (enabled) {
                if (destinationId == null) conflict(Metadata.Vk.NOT_READY)
                open(activeToken)
            }
            this.enabled = enabled
            audit.audit(
                actor,
                actor,
                if (enabled) Metadata.Vk.ACTIVATED else Metadata.Vk.DISABLED,
                previous,
                activePeer,
            )
        }

    private fun change(version: Long, action: VkSettingsEntity.() -> Unit): VkSettingsView =
        requireNotNull(
            transactions.execute {
                val row = settings.locked()
                requireVersion(row, version)
                row.action()
                row.version++
                view(row)
            }
        )

    private fun requireVersion(row: VkSettingsEntity, version: Long) {
        if (row.version != version) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
    }

    private fun open(ciphertext: ByteArray?): String {
        if (ciphertext == null) conflict(Metadata.Vk.NOT_READY)
        return runCatching { box.open(ciphertext) }
            .getOrElse { unavailable(Metadata.Vk.KEY_STORAGE) }
    }

    private fun VkSettingsEntity.clearTest() {
        testStatus = null
        testError = null
        testStarted = null
        testRandomId = null
    }

    private fun VkSettingsEntity.runningTest(): Boolean =
        testStatus == Metadata.Vk.SENDING &&
            testStarted?.plusSeconds(Metadata.Vk.TEST_LEASE_SECONDS)?.isAfter(Instant.now()) == true

    private fun view(row: VkSettingsEntity): VkSettingsView {
        val storage =
            box.available() &&
                listOfNotNull(row.activeToken, row.draftToken).all {
                    runCatching { box.open(it) }.isSuccess
                }
        val testStatus =
            if (row.testStatus == Metadata.Vk.SENDING && !row.runningTest()) Metadata.Concept.FAILED
            else row.testStatus
        return VkSettingsView(
            row.version,
            row.enabled,
            storage,
            row.activePeer?.let { VkChat(it, row.activeTitle.orEmpty()) },
            row.draftToken != null,
            row.draftPeer?.let { VkChat(it, row.draftTitle.orEmpty()) },
            testStatus,
            when {
                !storage -> Metadata.Vk.KEY_STORAGE
                row.testStatus == Metadata.Vk.SENDING && testStatus == Metadata.Concept.FAILED ->
                    Metadata.Vk.API_UNAVAILABLE
                else -> row.testError
            },
        )
    }

    private fun <T> vkRequest(action: () -> T): T =
        try {
            action()
        } catch (failure: VkFailure) {
            if (failure.temporary) unavailable(failure.code)
            badRequest(failure.code)
        }

    private class TestClaim(val version: Long, val key: String, val peer: Long, val randomId: Int)
}
