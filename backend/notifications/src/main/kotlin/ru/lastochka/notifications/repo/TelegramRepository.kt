package ru.lastochka.notifications.repo

import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.notifications.dto.DeliveryView
import ru.lastochka.notifications.dto.TelegramItem
import ru.lastochka.notifications.entity.TelegramOutboxEntity

interface TelegramClaim {
    val enquiryId: UUID
    val body: String
    val attempts: Int
}

interface TelegramView {
    val status: String
    val attempts: Int
    val error: String?
}

interface TelegramQueries : JpaRepository<TelegramOutboxEntity, UUID> {
    @Modifying
    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(
        value = "INSERT INTO telegram_outbox(enquiry_id,body) VALUES(:id,:body)",
        nativeQuery = true,
    )
    fun enqueue(id: UUID, body: String): Int

    @Modifying
    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(
        value =
            "UPDATE telegram_outbox SET status='FAILED',lease_until=NULL,last_error='TRANSIENT' WHERE status IN ('PENDING','RETRY_WAIT') AND attempts>=:max AND (lease_until IS NULL OR lease_until<now())",
        nativeQuery = true,
    )
    fun expire(max: Int): Int

    // PostgreSQL SKIP LOCKED и RETURNING обеспечивают атомарный захват и возврат попытки.
    // Native SQL: сохранить блокировку PostgreSQL, вернуть результат атомарного изменения,
    // сохранить SQL-операции PostgreSQL.
    @Query(
        value =
            "UPDATE telegram_outbox SET attempts=attempts+1, lease_until=now()+make_interval(secs => :lease) WHERE enquiry_id=(SELECT enquiry_id FROM telegram_outbox WHERE status IN ('PENDING','RETRY_WAIT') AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY created_at,enquiry_id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING enquiry_id AS \"enquiryId\",body,attempts",
        nativeQuery = true,
    )
    fun claim(lease: Long): TelegramClaim?

    @Modifying
    // Native SQL: сохранить SQL-операции PostgreSQL.
    @Query(
        value =
            "UPDATE telegram_outbox SET status=:status,message_id=:message,last_error=:error,lease_until=NULL,next_attempt_at=now()+make_interval(secs => :delay) WHERE enquiry_id=:id AND attempts=:attempt AND status IN ('PENDING','RETRY_WAIT')",
        nativeQuery = true,
    )
    fun finish(
        id: UUID,
        attempt: Int,
        status: String,
        message: Long?,
        error: String?,
        delay: Long,
    ): Int

    @Query(
        "select t.status as status,t.attempts as attempts,t.lastError as error from TelegramOutboxEntity t where t.enquiryId=:id"
    )
    fun view(id: UUID): TelegramView?

    @Modifying
    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(
        value =
            "UPDATE telegram_outbox SET status='PENDING',attempts=0,next_attempt_at=now(),last_error=NULL WHERE enquiry_id=:id AND status='FAILED' AND (lease_until IS NULL OR lease_until<now())",
        nativeQuery = true,
    )
    fun retry(id: UUID): Int
}

@Repository
class TelegramRepository(private val queries: TelegramQueries) {
    @Transactional
    fun enqueue(id: UUID, body: String) {
        queries.enqueue(id, body)
    }

    @Transactional
    fun claim(): TelegramItem? {
        queries.expire(Metadata.Concept.MAX_ATTEMPTS)
        return queries.claim(Metadata.Concept.LEASE_SECONDS)?.let {
            TelegramItem(it.enquiryId, it.body, it.attempts)
        }
    }

    @Transactional
    fun finish(item: TelegramItem, message: Long?, status: String, error: String?, delay: Long) {
        queries.finish(item.enquiryId, item.attempts, status, message, error, delay)
    }

    fun view(id: UUID, configured: Boolean): DeliveryView? =
        queries.view(id)?.let { DeliveryView(it.status, it.attempts, it.error, configured) }

    @Transactional fun retry(id: UUID): Int = queries.retry(id)
}
