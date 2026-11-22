package ru.lastochka.notifications.service

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import ru.lastochka.common.Metadata

@Component
@ConditionalOnProperty(
    name = [Metadata.Configuration.WORKERS_ENABLED, Metadata.Vk.WORKER_ENABLED],
    havingValue = "true",
    matchIfMissing = true,
)
class VkWorker(private val delivery: VkDelivery) {
    @Scheduled(fixedDelay = Metadata.Concept.POLL_MILLIS) fun send() = delivery.processNext()
}
