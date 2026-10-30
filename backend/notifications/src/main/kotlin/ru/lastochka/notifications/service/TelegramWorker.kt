package ru.lastochka.notifications.service

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import ru.lastochka.common.Metadata

@Component
@ConditionalOnProperty(
    name = [Metadata.Configuration.WORKERS_ENABLED],
    havingValue = "true",
    matchIfMissing = true,
)
class TelegramWorker(private val queue: TelegramQueue) {
    @Scheduled(fixedDelay = Metadata.Concept.POLL_MILLIS)
    fun send() {
        queue.claim()?.let { queue.deliver(it) }
    }
}
