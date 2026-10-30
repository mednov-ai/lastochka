package ru.lastochka.notifications.repo

import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import ru.lastochka.notifications.dto.NotificationSettings

@Repository
class NotificationSettingsRepository(private val jdbc: JdbcClient) {
    fun get(lock: Boolean = false): NotificationSettings =
        jdbc
            .sql(
                "SELECT telegram_enabled,browser_push_enabled,version FROM enquiry_notification_settings WHERE id=1" +
                    if (lock) " FOR SHARE" else ""
            )
            .query { r, _ ->
                NotificationSettings(
                    r.getBoolean("telegram_enabled"),
                    r.getBoolean("browser_push_enabled"),
                    r.getLong("version"),
                )
            }
            .single()

    fun update(value: NotificationSettings): Boolean =
        jdbc
            .sql(
                "UPDATE enquiry_notification_settings SET telegram_enabled=:telegram,browser_push_enabled=:push,version=version+1 WHERE id=1 AND version=:version"
            )
            .param("telegram", value.telegramEnabled)
            .param("push", value.browserPushEnabled)
            .param("version", value.version)
            .update() == 1
}
