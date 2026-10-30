package ru.lastochka.enquiries.controller

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController
import ru.lastochka.common.Metadata
import ru.lastochka.notifications.dto.NotificationSettings
import ru.lastochka.notifications.service.NotificationSettingsService

@RestController
class NotificationSettingsController(private val settings: NotificationSettingsService) {
    @GetMapping(Metadata.Concept.NOTIFICATION_SETTINGS)
    fun get(): NotificationSettings = settings.get()

    @PutMapping(Metadata.Concept.NOTIFICATION_SETTINGS)
    fun update(@RequestBody value: NotificationSettings): NotificationSettings =
        settings.update(value)
}
