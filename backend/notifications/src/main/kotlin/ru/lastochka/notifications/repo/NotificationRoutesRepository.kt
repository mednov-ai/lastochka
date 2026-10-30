package ru.lastochka.notifications.repo

import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.notifications.dto.NotificationSettings
import ru.lastochka.notifications.dto.PushSummary
import ru.lastochka.notifications.dto.PushTarget
import ru.lastochka.notifications.entity.NotificationRouteEntity

interface NotificationTargetProjection {
    val id: UUID
    val accountId: UUID
    val authVersion: Long
}

interface NotificationSummaryProjection {
    val selected: Boolean
    val subscriptions: Int
    val waiting: Long
    val accepted: Long
    val failed: Long
}

interface NotificationRoutesQueries : JpaRepository<NotificationRouteEntity, UUID> {
    @Modifying
    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(
        value =
            "INSERT INTO enquiry_notification_routes(enquiry_id,telegram_enabled,browser_push_enabled) VALUES(:id,:telegram,:push)",
        nativeQuery = true,
    )
    fun record(id: UUID, telegram: Boolean, push: Boolean): Int

    // Порядок блокировки подписок сохраняется для атомарной маршрутизации заявки.
    // Native SQL: сохранить блокировку PostgreSQL.
    @Query(
        value =
            "SELECT id,account_id AS \"accountId\",auth_version AS \"authVersion\" FROM browser_push_subscriptions WHERE generation_hash=:generation AND active ORDER BY id FOR UPDATE",
        nativeQuery = true,
    )
    fun targets(generation: String): List<NotificationTargetProjection>

    @Modifying
    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(
        value = "INSERT INTO browser_push_outbox(enquiry_id,subscription_id) VALUES(:id,:target)",
        nativeQuery = true,
    )
    fun enqueue(id: UUID, target: UUID): Int

    @Modifying
    @Query("update PushSubscriptionEntity s set s.active=false where s.id=:target")
    fun deactivate(target: UUID): Int

    @Modifying
    @Query("update NotificationRouteEntity r set r.pushSubscriptions=:count where r.enquiryId=:id")
    fun count(id: UUID, count: Int): Int

    // FILTER и группировка используют PostgreSQL и сохраняют сводку очереди.
    // Native SQL: сохранить SQL-операции PostgreSQL, сохранить соединение таблиц владельцев.
    @Query(
        value =
            """SELECT r.browser_push_enabled AS selected,r.push_subscriptions AS subscriptions,
        count(o.subscription_id) FILTER (WHERE o.status IN ('PENDING','RETRY_WAIT')) AS waiting,
        count(o.subscription_id) FILTER (WHERE o.status='ACCEPTED') AS accepted,
        count(o.subscription_id) FILTER (WHERE o.status IN ('FAILED','CANCELLED')) AS failed
        FROM enquiry_notification_routes r LEFT JOIN browser_push_outbox o ON o.enquiry_id=r.enquiry_id
        WHERE r.enquiry_id=:id GROUP BY r.enquiry_id""",
        nativeQuery = true,
    )
    fun summary(id: UUID): NotificationSummaryProjection?
}

@Repository
class NotificationRoutesRepository(private val queries: NotificationRoutesQueries) {
    @Transactional
    fun record(id: UUID, settings: NotificationSettings) {
        queries.record(id, settings.telegramEnabled, settings.browserPushEnabled)
    }

    fun targets(generation: String): List<PushTarget> =
        queries.targets(generation).map { PushTarget(it.id, it.accountId, it.authVersion) }

    @Transactional
    fun enqueue(id: UUID, target: UUID) {
        queries.enqueue(id, target)
    }

    @Transactional
    fun deactivate(target: UUID) {
        queries.deactivate(target)
    }

    @Transactional
    fun count(id: UUID, count: Int) {
        queries.count(id, count)
    }

    fun summary(id: UUID, configured: Boolean): PushSummary? =
        queries.summary(id)?.let {
            PushSummary(
                it.selected,
                configured,
                it.subscriptions,
                it.waiting.toInt(),
                it.accepted.toInt(),
                it.failed.toInt(),
            )
        }
}
