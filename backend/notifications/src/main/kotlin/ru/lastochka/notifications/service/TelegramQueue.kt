package ru.lastochka.notifications.service

import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.*
import ru.lastochka.common.service.CommandService
import ru.lastochka.notifications.dto.*
import ru.lastochka.notifications.repo.TelegramRepository

@Service
class TelegramQueue(
    private val storage: TelegramRepository,
    private val sender: TelegramSender,
    private val commands: CommandService,
) {
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    fun enqueue(id: UUID, body: String) {
        require(body.length <= Metadata.Concept.TELEGRAM_MESSAGE_LIMIT)
        storage.enqueue(id, body)
    }

    @Transactional fun claim(): TelegramItem? = if (sender.configured()) storage.claim() else null

    fun view(id: UUID): DeliveryView =
        storage.view(id, sender.configured())
            ?: DeliveryView(Metadata.BrowserPush.STATUS_NOT_SELECTED, 0, null, sender.configured())

    @Transactional
    fun retry(id: UUID, actor: UUID): DeliveryView {
        commands.lockStudio()
        if (storage.retry(id) != 1) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        commands.audit(id, actor, Metadata.Concept.DELIVERY_RETRY, null, null)
        return view(id)
    }

    fun deliver(item: TelegramItem) {
        val result =
            try {
                sender.send(item.body)
            } catch (_: Exception) {
                TelegramResult()
            }
        val status =
            when {
                result.messageId != null -> Metadata.Concept.DELIVERED
                result.permanent || item.attempts >= Metadata.Concept.MAX_ATTEMPTS ->
                    Metadata.Concept.FAILED
                else -> Metadata.Concept.RETRY_WAIT
            }
        val delay =
            result.retrySeconds
                ?: (Metadata.Concept.INITIAL_DELAY_SECONDS * item.attempts * item.attempts)
                    .coerceAtMost(Metadata.Concept.MAX_DELAY_SECONDS)
        storage.finish(
            item,
            result.messageId,
            status,
            if (result.messageId != null) null
            else if (result.chatMigrated) Metadata.Concept.TELEGRAM_CHAT_MIGRATED
            else if (result.permanent) Metadata.Concept.REJECTED else Metadata.Concept.TRANSIENT,
            delay,
        )
    }
}
