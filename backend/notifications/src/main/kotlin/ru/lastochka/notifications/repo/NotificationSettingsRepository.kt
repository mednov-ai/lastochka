package ru.lastochka.notifications.repo

import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import ru.lastochka.notifications.dto.NotificationSettings
import ru.lastochka.notifications.entity.NotificationSettingsEntity

interface NotificationSettingsProjection {
    val telegramEnabled: Boolean
    val browserPushEnabled: Boolean
    val version: Long
}

interface NotificationSettingsQueries : JpaRepository<NotificationSettingsEntity, Int> {
    @Query(
        "select s.telegramEnabled as telegramEnabled, s.browserPushEnabled as browserPushEnabled, s.version as version from NotificationSettingsEntity s where s.id=1"
    )
    fun current(): NotificationSettingsProjection

    // FOR SHARE сохраняет существующую блокировку снимка настройки на время обработки заявки.
    // Native SQL: сохранить блокировку PostgreSQL.
    @Query(
        value =
            "SELECT telegram_enabled AS \"telegramEnabled\", browser_push_enabled AS \"browserPushEnabled\", version FROM enquiry_notification_settings WHERE id=1 FOR SHARE",
        nativeQuery = true,
    )
    fun currentLocked(): NotificationSettingsProjection

    @Modifying
    @Query(
        "update NotificationSettingsEntity s set s.telegramEnabled=:telegram, s.browserPushEnabled=:push, s.version=s.version+1 where s.id=1 and s.version=:version"
    )
    fun updateIfVersion(telegram: Boolean, push: Boolean, version: Long): Int
}

@Repository
class NotificationSettingsRepository(private val queries: NotificationSettingsQueries) {
    fun get(lock: Boolean = false): NotificationSettings {
        val value = if (lock) queries.currentLocked() else queries.current()
        return NotificationSettings(value.telegramEnabled, value.browserPushEnabled, value.version)
    }

    fun update(value: NotificationSettings): Boolean =
        queries.updateIfVersion(value.telegramEnabled, value.browserPushEnabled, value.version) == 1
}
