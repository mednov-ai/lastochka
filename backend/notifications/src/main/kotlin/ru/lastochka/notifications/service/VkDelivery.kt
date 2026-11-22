package ru.lastochka.notifications.service

import java.net.URI
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.conflict
import ru.lastochka.common.service.CommandService
import ru.lastochka.common.service.UserMessages
import ru.lastochka.notifications.dto.VkDeliveryAttempt
import ru.lastochka.notifications.dto.VkDeliveryView
import ru.lastochka.notifications.dto.VkSendResult
import ru.lastochka.notifications.entity.VkOutboxEntity
import ru.lastochka.notifications.repo.VkOutboxRepository
import ru.lastochka.notifications.repo.VkSettingsRepository

@Service
class VkDelivery(
    private val settings: VkSettingsRepository,
    private val outbox: VkOutboxRepository,
    private val box: VkSecretBox,
    private val api: VkApiClient,
    private val commands: CommandService,
    private val texts: UserMessages,
    private val transactions: TransactionTemplate,
    @Value(Metadata.Vk.PUBLIC_URL) publicUrl: String,
) {
    private val adminUrl = URI(publicUrl.trimEnd('/') + "/").resolve("admin/requests").toString()

    @org.springframework.transaction.annotation.Transactional(
        propagation = org.springframework.transaction.annotation.Propagation.MANDATORY
    )
    fun enqueue(id: UUID, number: Long) {
        val config = settings.locked()
        val destination = config.destinationId ?: return
        if (!config.enabled) return
        outbox.save(VkOutboxEntity(id, destination, number, box.randomId(settings.nextRandomId())))
    }

    fun view(id: UUID): VkDeliveryView {
        val destination = settings.current().destinationId
        val item =
            outbox.findById(id).orElse(null)
                ?: return VkDeliveryView(Metadata.BrowserPush.STATUS_NOT_SELECTED, 0, null, false)
        val isCurrent = item.destinationId == destination
        val status =
            when {
                item.status == Metadata.Concept.DELIVERED -> item.status
                !isCurrent && (item.leaseUntil?.isAfter(Instant.now()) != true) ->
                    Metadata.Vk.STOPPED
                item.leaseUntil?.isAfter(Instant.now()) == true -> Metadata.Vk.SENDING
                else -> item.status
            }
        return VkDeliveryView(
            status,
            item.attempts,
            if (status == Metadata.Vk.STOPPED) Metadata.Vk.DESTINATION_CHANGED else item.lastError,
            isCurrent && status == Metadata.Concept.FAILED,
        )
    }

    fun retry(id: UUID, actor: UUID): VkDeliveryView {
        transactions.executeWithoutResult {
            commands.lockStudio()
            val config = settings.locked()
            val item = outbox.locked(id) ?: conflict(Metadata.Vk.NOT_READY)
            if (item.destinationId != config.destinationId)
                conflict(Metadata.Vk.DESTINATION_CHANGED)
            if (item.status != Metadata.Concept.FAILED)
                conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            if (config.activeToken?.let { runCatching { box.open(it) }.isSuccess } != true)
                conflict(Metadata.Vk.KEY_STORAGE)
            item.status = Metadata.Concept.PENDING
            item.attempts = 0
            item.lastError = null
            item.nextAttemptAt = Instant.now()
            commands.audit(id, actor, Metadata.Vk.RETRIED, null, null)
        }
        return view(id)
    }

    fun processNext() {
        val attempt = claim() ?: return
        val config = settings.current()
        val peer = config.activePeer
        val result =
            when {
                attempt.destination != config.destinationId || peer == null ->
                    VkSendResult(error = Metadata.Vk.DESTINATION_CHANGED)
                else -> {
                    val key = config.activeToken?.let { runCatching { box.open(it) }.getOrNull() }
                    if (key == null) VkSendResult(error = Metadata.Vk.KEY_STORAGE)
                    else
                        api.send(
                            key,
                            peer,
                            attempt.randomId,
                            texts.render(
                                Metadata.Vk.ENQUIRY_MESSAGE,
                                attempt.number.toString(),
                                "$adminUrl?enquiry=${attempt.id}",
                            ),
                        )
                }
            }
        finish(attempt, result)
    }

    private fun claim(): VkDeliveryAttempt? = transactions.execute {
        val destination = settings.locked().destinationId ?: return@execute null
        val item = outbox.next(destination) ?: return@execute null
        if (item.attempts >= Metadata.Concept.MAX_ATTEMPTS) {
            item.status = Metadata.Concept.FAILED
            item.lastError = Metadata.Vk.API_UNAVAILABLE
            item.leaseUntil = null
            return@execute null
        }
        item.attempts++
        val lease =
            Instant.now().plusSeconds(Metadata.Concept.LEASE_SECONDS).truncatedTo(ChronoUnit.MICROS)
        item.leaseUntil = lease
        VkDeliveryAttempt(
            item.enquiryId,
            item.destinationId,
            item.enquiryNumber,
            item.randomId,
            item.attempts,
            lease,
        )
    }

    private fun finish(attempt: VkDeliveryAttempt, result: VkSendResult) {
        transactions.executeWithoutResult {
            val item = outbox.locked(attempt.id) ?: return@executeWithoutResult
            if (item.attempts != attempt.attempt || item.leaseUntil != attempt.lease)
                return@executeWithoutResult
            item.messageId = result.messageId
            item.lastError = result.error
            item.leaseUntil = null
            item.status =
                when {
                    result.messageId != null -> Metadata.Concept.DELIVERED
                    result.temporary && attempt.attempt < Metadata.Concept.MAX_ATTEMPTS ->
                        Metadata.Concept.RETRY_WAIT
                    else -> Metadata.Concept.FAILED
                }
            val delay =
                (Metadata.Concept.INITIAL_DELAY_SECONDS * attempt.attempt * attempt.attempt)
                    .coerceAtMost(Metadata.Concept.MAX_DELAY_SECONDS)
            item.nextAttemptAt = Instant.now().plusSeconds(delay)
        }
    }
}
