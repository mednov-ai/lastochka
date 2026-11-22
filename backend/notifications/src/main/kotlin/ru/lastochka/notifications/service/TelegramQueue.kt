package ru.lastochka.notifications.service

import java.util.UUID
import org.springframework.stereotype.Service
import ru.lastochka.common.Metadata
import ru.lastochka.notifications.dto.DeliveryView
import ru.lastochka.notifications.repo.TelegramRepository

@Service
class TelegramQueue(private val storage: TelegramRepository) {
    fun view(id: UUID): DeliveryView =
        storage.view(id)?.let {
            if (it.status in setOf(Metadata.Concept.PENDING, Metadata.Concept.RETRY_WAIT))
                it.copy(status = Metadata.Vk.STOPPED, error = Metadata.Vk.TELEGRAM_RETIRED)
            else it
        } ?: DeliveryView(Metadata.BrowserPush.STATUS_NOT_SELECTED, 0, null, false)
}
