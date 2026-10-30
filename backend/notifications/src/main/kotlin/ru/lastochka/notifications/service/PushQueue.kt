package ru.lastochka.notifications.service

import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.identity.service.AccountService
import ru.lastochka.notifications.dto.PushDelivery
import ru.lastochka.notifications.repo.PushOutboxRepository

@Service
class PushQueue(
    private val storage: PushOutboxRepository,
    private val sender: PushSender,
    private val routes: NotificationRoutes,
    private val accounts: AccountService,
) {
    @Transactional
    fun claim(): PushDelivery? {
        storage.retireStale(routes.generationHash)
        return if (sender.configured()) storage.claim(routes.generationHash) else null
    }

    @Transactional
    fun deliver(item: PushDelivery) {
        if (
            !storage.stillActive(item, routes.generationHash) ||
                !accounts.pushEligible(item.accountId, item.authVersion)
        ) {
            storage.deactivate(item.subscriptionId)
            storage.finish(item, Metadata.BrowserPush.STATUS_CANCELLED, 0)
            return
        }
        val (code, retryAfter) =
            try {
                sender.send(item)
            } catch (_: Exception) {
                0 to null
            }
        val dead =
            code == Metadata.BrowserPush.HTTP_GONE || code == Metadata.BrowserPush.HTTP_NOT_FOUND
        if (dead) storage.deactivate(item.subscriptionId)
        val status =
            when {
                code in Metadata.Concept.HTTP_SUCCESS -> Metadata.BrowserPush.STATUS_ACCEPTED
                dead -> Metadata.BrowserPush.STATUS_CANCELLED
                code == Metadata.Http.TOO_MANY_REQUESTS &&
                    (retryAfter ?: 0) > Metadata.BrowserPush.OUTBOX_TTL_SECONDS ->
                    Metadata.Concept.FAILED
                code in Metadata.Concept.HTTP_PERMANENT &&
                    code != Metadata.Http.TOO_MANY_REQUESTS -> Metadata.Concept.FAILED
                item.attempts >= Metadata.BrowserPush.MAX_ATTEMPTS -> Metadata.Concept.FAILED
                else -> Metadata.Concept.RETRY_WAIT
            }
        val delay =
            (Metadata.BrowserPush.INITIAL_DELAY_SECONDS * item.attempts * item.attempts)
                .coerceAtMost(Metadata.BrowserPush.MAX_DELAY_SECONDS)
        storage.finish(
            item,
            status,
            if (code == Metadata.Http.TOO_MANY_REQUESTS)
                retryAfter
                    ?.coerceAtLeast(delay)
                    ?.coerceAtMost(Metadata.BrowserPush.OUTBOX_TTL_SECONDS) ?: delay
            else delay,
        )
    }
}
