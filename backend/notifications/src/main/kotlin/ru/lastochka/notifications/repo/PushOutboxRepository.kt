package ru.lastochka.notifications.repo

import java.util.UUID
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import ru.lastochka.common.Metadata
import ru.lastochka.notifications.dto.PushDelivery

@Repository
class PushOutboxRepository(private val jdbc: JdbcClient) {
    fun retireStale(generation: String) {
        jdbc
            .sql(
                "UPDATE browser_push_subscriptions SET active=false WHERE generation_hash<>:generation AND active"
            )
            .param("generation", generation)
            .update()
        jdbc
            .sql(
                """UPDATE browser_push_outbox o SET status='CANCELLED',lease_until=NULL
            FROM browser_push_subscriptions s WHERE o.subscription_id=s.id AND o.status IN ('PENDING','RETRY_WAIT')
            AND NOT s.active AND (o.lease_until IS NULL OR o.lease_until<now())"""
            )
            .update()
    }

    fun claim(generation: String): PushDelivery? {
        jdbc
            .sql(
                """UPDATE browser_push_outbox o SET status='CANCELLED',lease_until=NULL
            FROM browser_push_subscriptions s WHERE o.subscription_id=s.id AND o.status IN ('PENDING','RETRY_WAIT')
            AND (NOT s.active OR s.generation_hash<>:generation) AND (o.lease_until IS NULL OR o.lease_until<now())"""
            )
            .param("generation", generation)
            .update()
        jdbc
            .sql(
                """UPDATE browser_push_outbox SET status='FAILED',lease_until=NULL
            WHERE status IN ('PENDING','RETRY_WAIT') AND (attempts>=:max OR created_at<now()-make_interval(secs=>:ttl))
            AND (lease_until IS NULL OR lease_until<now())"""
            )
            .param("max", Metadata.BrowserPush.MAX_ATTEMPTS)
            .param("ttl", Metadata.BrowserPush.OUTBOX_TTL_SECONDS)
            .update()
        return jdbc
            .sql(
                """WITH candidate AS (
            SELECT o.enquiry_id,o.subscription_id FROM browser_push_outbox o
            JOIN browser_push_subscriptions s ON s.id=o.subscription_id
            WHERE o.status IN ('PENDING','RETRY_WAIT') AND o.next_attempt_at<=now()
              AND (o.lease_until IS NULL OR o.lease_until<now()) AND s.active AND s.generation_hash=:generation
            ORDER BY o.created_at,o.enquiry_id FOR UPDATE OF o SKIP LOCKED LIMIT 1
        ), claimed AS (
            UPDATE browser_push_outbox o SET attempts=o.attempts+1,lease_until=now()+make_interval(secs=>:lease)
            FROM candidate c WHERE o.enquiry_id=c.enquiry_id AND o.subscription_id=c.subscription_id
            RETURNING o.enquiry_id,o.subscription_id,o.attempts
        ) SELECT c.enquiry_id,c.subscription_id,c.attempts,s.account_id,s.auth_version,s.endpoint,s.p256dh,s.auth_secret,e.public_number
          FROM claimed c JOIN browser_push_subscriptions s ON s.id=c.subscription_id JOIN enrollment_requests e ON e.id=c.enquiry_id"""
            )
            .param("generation", generation)
            .param("lease", Metadata.BrowserPush.LEASE_SECONDS)
            .query { r, _ ->
                PushDelivery(
                    r.getObject("enquiry_id", UUID::class.java),
                    r.getObject("subscription_id", UUID::class.java),
                    r.getObject("account_id", UUID::class.java),
                    r.getLong("auth_version"),
                    r.getString("endpoint"),
                    r.getString("p256dh"),
                    r.getString("auth_secret"),
                    r.getLong("public_number"),
                    r.getInt("attempts"),
                )
            }
            .optional()
            .orElse(null)
    }

    fun stillActive(item: PushDelivery, generation: String): Boolean =
        jdbc
            .sql(
                "SELECT id FROM browser_push_subscriptions WHERE id=:id AND active AND generation_hash=:generation AND auth_version=:version FOR UPDATE"
            )
            .param("id", item.subscriptionId)
            .param("generation", generation)
            .param("version", item.authVersion)
            .query(UUID::class.java)
            .optional()
            .isPresent

    fun finish(item: PushDelivery, status: String, delay: Long) {
        jdbc
            .sql(
                """UPDATE browser_push_outbox SET status=:status,lease_until=NULL,next_attempt_at=now()+make_interval(secs=>:delay)
            WHERE enquiry_id=:enquiry AND subscription_id=:subscription AND attempts=:attempt AND status IN ('PENDING','RETRY_WAIT')"""
            )
            .params(
                mapOf(
                    "status" to status,
                    "delay" to delay,
                    "enquiry" to item.enquiryId,
                    "subscription" to item.subscriptionId,
                    "attempt" to item.attempts,
                )
            )
            .update()
    }

    fun deactivate(id: UUID) {
        jdbc
            .sql("UPDATE browser_push_subscriptions SET active=false WHERE id=:id")
            .param("id", id)
            .update()
    }
}
