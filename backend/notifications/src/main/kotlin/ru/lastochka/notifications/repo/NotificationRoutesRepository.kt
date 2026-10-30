package ru.lastochka.notifications.repo

import java.util.UUID
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import ru.lastochka.notifications.dto.NotificationSettings
import ru.lastochka.notifications.dto.PushSummary
import ru.lastochka.notifications.dto.PushTarget

@Repository
class NotificationRoutesRepository(private val jdbc: JdbcClient) {
    fun record(id: UUID, settings: NotificationSettings) {
        jdbc
            .sql(
                "INSERT INTO enquiry_notification_routes(enquiry_id,telegram_enabled,browser_push_enabled) VALUES(:id,:telegram,:push)"
            )
            .param("id", id)
            .param("telegram", settings.telegramEnabled)
            .param("push", settings.browserPushEnabled)
            .update()
    }

    fun targets(generation: String): List<PushTarget> =
        jdbc
            .sql(
                "SELECT id,account_id,auth_version FROM browser_push_subscriptions WHERE generation_hash=:generation AND active ORDER BY id FOR UPDATE"
            )
            .param("generation", generation)
            .query { r, _ ->
                PushTarget(
                    r.getObject("id", UUID::class.java),
                    r.getObject("account_id", UUID::class.java),
                    r.getLong("auth_version"),
                )
            }
            .list()

    fun enqueue(id: UUID, target: UUID) {
        jdbc
            .sql("INSERT INTO browser_push_outbox(enquiry_id,subscription_id) VALUES(:id,:target)")
            .param("id", id)
            .param("target", target)
            .update()
    }

    fun deactivate(target: UUID) {
        jdbc
            .sql("UPDATE browser_push_subscriptions SET active=false WHERE id=:id")
            .param("id", target)
            .update()
    }

    fun count(id: UUID, count: Int) {
        jdbc
            .sql(
                "UPDATE enquiry_notification_routes SET push_subscriptions=:count WHERE enquiry_id=:id"
            )
            .param("id", id)
            .param("count", count)
            .update()
    }

    fun summary(id: UUID, configured: Boolean): PushSummary? =
        jdbc
            .sql(
                """SELECT r.browser_push_enabled,r.push_subscriptions,
            count(o.subscription_id) FILTER (WHERE o.status IN ('PENDING','RETRY_WAIT')) AS waiting,
            count(o.subscription_id) FILTER (WHERE o.status='ACCEPTED') AS accepted,
            count(o.subscription_id) FILTER (WHERE o.status IN ('FAILED','CANCELLED')) AS failed
            FROM enquiry_notification_routes r LEFT JOIN browser_push_outbox o ON o.enquiry_id=r.enquiry_id
            WHERE r.enquiry_id=:id GROUP BY r.enquiry_id"""
            )
            .param("id", id)
            .query { r, _ ->
                PushSummary(
                    r.getBoolean("browser_push_enabled"),
                    configured,
                    r.getInt("push_subscriptions"),
                    r.getInt("waiting"),
                    r.getInt("accepted"),
                    r.getInt("failed"),
                )
            }
            .optional()
            .orElse(null)
}
