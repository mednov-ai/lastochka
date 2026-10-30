package ru.lastochka.notifications.repo

import java.util.UUID
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import ru.lastochka.common.Metadata
import ru.lastochka.notifications.dto.*

@Repository
class TelegramRepository(private val jdbc: JdbcClient) {
    fun enqueue(id: UUID, body: String) {
        jdbc
            .sql("INSERT INTO telegram_outbox(enquiry_id,body) VALUES(:id,:body)")
            .param("id", id)
            .param("body", body)
            .update()
    }

    fun claim(): TelegramItem? {
        jdbc
            .sql(
                "UPDATE telegram_outbox SET status='FAILED',lease_until=NULL,last_error='TRANSIENT' WHERE status IN ('PENDING','RETRY_WAIT') AND attempts>=:max AND (lease_until IS NULL OR lease_until<now())"
            )
            .param("max", Metadata.Concept.MAX_ATTEMPTS)
            .update()
        return jdbc
            .sql(
                "UPDATE telegram_outbox SET attempts=attempts+1, lease_until=now()+make_interval(secs => :lease) WHERE enquiry_id=(SELECT enquiry_id FROM telegram_outbox WHERE status IN ('PENDING','RETRY_WAIT') AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at,enquiry_id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING enquiry_id,body,attempts"
            )
            .param("lease", Metadata.Concept.LEASE_SECONDS)
            .query { r, _ ->
                TelegramItem(
                    r.getObject("enquiry_id", UUID::class.java),
                    r.getString("body"),
                    r.getInt("attempts"),
                )
            }
            .optional()
            .orElse(null)
    }

    fun finish(item: TelegramItem, message: Long?, status: String, error: String?, delay: Long) {
        jdbc
            .sql(
                "UPDATE telegram_outbox SET status=:status,message_id=:message,last_error=:error,lease_until=NULL,next_attempt_at=now()+make_interval(secs => :delay) WHERE enquiry_id=:id AND attempts=:attempt AND status IN ('PENDING','RETRY_WAIT')"
            )
            .params(
                mapOf(
                    "id" to item.enquiryId,
                    "attempt" to item.attempts,
                    "status" to status,
                    "message" to message,
                    "error" to error,
                    "delay" to delay,
                )
            )
            .update()
    }

    fun view(id: UUID, configured: Boolean): DeliveryView? =
        jdbc
            .sql("SELECT status,attempts,last_error FROM telegram_outbox WHERE enquiry_id=:id")
            .param("id", id)
            .query { r, _ ->
                DeliveryView(
                    r.getString("status"),
                    r.getInt("attempts"),
                    r.getString("last_error"),
                    configured,
                )
            }
            .optional()
            .orElse(null)

    fun retry(id: UUID): Int =
        jdbc
            .sql(
                "UPDATE telegram_outbox SET status='PENDING',attempts=0,next_attempt_at=now(),last_error=NULL WHERE enquiry_id=:id AND status='FAILED' AND (lease_until IS NULL OR lease_until<now())"
            )
            .param("id", id)
            .update()
}
