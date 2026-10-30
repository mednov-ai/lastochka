package ru.lastochka.notifications.service

import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.conflict
import ru.lastochka.notifications.dto.NotificationSettings
import ru.lastochka.notifications.repo.NotificationSettingsRepository

@Service
class NotificationSettingsService(
    private val storage: NotificationSettingsRepository,
    private val telegram: TelegramSender,
    private val push: PushSender,
) {
    fun get(): NotificationSettings =
        storage
            .get()
            .copy(telegramConfigured = telegram.configured(), pushConfigured = push.configured())

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    fun snapshot(): NotificationSettings = storage.get(lock = true)

    @Transactional
    fun update(value: NotificationSettings): NotificationSettings {
        if (!storage.update(value)) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        return get()
    }
}
