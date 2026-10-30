package ru.lastochka.notifications.repo

import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.notifications.dto.PushDelivery
import ru.lastochka.notifications.entity.PushSubscriptionEntity

interface PushClaim {
    val enquiryId: UUID
    val subscriptionId: UUID
    val accountId: UUID
    val authVersion: Long
    val endpoint: String
    val p256dh: String
    val authSecret: String
    val publicNumber: Long
    val attempts: Int
}

interface PushOutboxQueries : JpaRepository<PushSubscriptionEntity, UUID> {
    @Modifying
    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(
        value =
            "UPDATE browser_push_subscriptions SET active=false WHERE generation_hash<>:generation AND active",
        nativeQuery = true,
    )
    fun retireSubscriptions(generation: String): Int

    @Modifying
    // Native SQL: сохранить SQL-операции PostgreSQL.
    @Query(
        value =
            """UPDATE browser_push_outbox o SET status='CANCELLED',lease_until=NULL
        FROM browser_push_subscriptions s WHERE o.subscription_id=s.id AND o.status IN ('PENDING','RETRY_WAIT')
        AND NOT s.active AND (o.lease_until IS NULL OR o.lease_until<now())""",
        nativeQuery = true,
    )
    fun cancelInactive(): Int

    @Modifying
    // Native SQL: сохранить SQL-операции PostgreSQL.
    @Query(
        value =
            """UPDATE browser_push_outbox o SET status='CANCELLED',lease_until=NULL
        FROM browser_push_subscriptions s WHERE o.subscription_id=s.id AND o.status IN ('PENDING','RETRY_WAIT')
        AND (NOT s.active OR s.generation_hash<>:generation) AND (o.lease_until IS NULL OR o.lease_until<now())""",
        nativeQuery = true,
    )
    fun cancelInvalid(generation: String): Int

    @Modifying
    // Native SQL: сохранить SQL-операции PostgreSQL.
    @Query(
        value =
            """UPDATE browser_push_outbox SET status='FAILED',lease_until=NULL
        WHERE status IN ('PENDING','RETRY_WAIT') AND (attempts>=:max OR created_at<now()-make_interval(secs=>:ttl))
        AND (lease_until IS NULL OR lease_until<now())""",
        nativeQuery = true,
    )
    fun expire(max: Int, ttl: Long): Int

    // PostgreSQL CTE и SKIP LOCKED объединяют выбор и захват в одну атомарную операцию.
    // Native SQL: сохранить блокировку PostgreSQL, вернуть результат атомарного изменения,
    // сохранить SQL-операции PostgreSQL, сохранить соединение таблиц владельцев.
    @Query(
        value =
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
    ) SELECT c.enquiry_id AS "enquiryId",c.subscription_id AS "subscriptionId",c.attempts,s.account_id AS "accountId",
      s.auth_version AS "authVersion",s.endpoint,s.p256dh,s.auth_secret AS "authSecret",e.public_number AS "publicNumber"
      FROM claimed c JOIN browser_push_subscriptions s ON s.id=c.subscription_id JOIN enrollment_requests e ON e.id=c.enquiry_id""",
        nativeQuery = true,
    )
    fun claim(generation: String, lease: Long): PushClaim?

    // Блокировка подписки сохраняет проверку активности перед доставкой.
    // Native SQL: сохранить блокировку PostgreSQL.
    @Query(
        value =
            "SELECT id FROM browser_push_subscriptions WHERE id=:id AND active AND generation_hash=:generation AND auth_version=:version FOR UPDATE",
        nativeQuery = true,
    )
    fun lockActive(id: UUID, generation: String, version: Long): UUID?

    @Modifying
    // Native SQL: сохранить SQL-операции PostgreSQL.
    @Query(
        value =
            """UPDATE browser_push_outbox SET status=:status,lease_until=NULL,next_attempt_at=now()+make_interval(secs=>:delay)
        WHERE enquiry_id=:enquiry AND subscription_id=:subscription AND attempts=:attempt AND status IN ('PENDING','RETRY_WAIT')""",
        nativeQuery = true,
    )
    fun finish(enquiry: UUID, subscription: UUID, attempt: Int, status: String, delay: Long): Int

    @Modifying
    @Query("update PushSubscriptionEntity s set s.active=false where s.id=:id")
    fun deactivate(id: UUID): Int
}

@Repository
class PushOutboxRepository(private val queries: PushOutboxQueries) {
    @Transactional
    fun retireStale(generation: String) {
        queries.retireSubscriptions(generation)
        queries.cancelInactive()
    }

    @Transactional
    fun claim(generation: String): PushDelivery? {
        queries.cancelInvalid(generation)
        queries.expire(Metadata.BrowserPush.MAX_ATTEMPTS, Metadata.BrowserPush.OUTBOX_TTL_SECONDS)
        return queries.claim(generation, Metadata.BrowserPush.LEASE_SECONDS)?.let {
            PushDelivery(
                it.enquiryId,
                it.subscriptionId,
                it.accountId,
                it.authVersion,
                it.endpoint,
                it.p256dh,
                it.authSecret,
                it.publicNumber,
                it.attempts,
            )
        }
    }

    @Transactional
    fun stillActive(item: PushDelivery, generation: String): Boolean =
        queries.lockActive(item.subscriptionId, generation, item.authVersion) != null

    @Transactional
    fun finish(item: PushDelivery, status: String, delay: Long) {
        queries.finish(item.enquiryId, item.subscriptionId, item.attempts, status, delay)
    }

    @Transactional
    fun deactivate(id: UUID) {
        queries.deactivate(id)
    }
}
