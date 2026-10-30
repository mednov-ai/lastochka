package ru.lastochka.notifications.repo

import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.notifications.dto.PushSubscriptionInput
import ru.lastochka.notifications.entity.PushSubscriptionEntity

interface PushSubscriptionQueries : JpaRepository<PushSubscriptionEntity, UUID> {
    // Атомарный upsert сохраняет идентификатор и запрещает переназначать endpoint другому
    // владельцу.
    // Native SQL: сохранить атомарный upsert, вернуть результат атомарного изменения.
    @Query(
        value =
            """INSERT INTO browser_push_subscriptions(id,account_id,auth_version,generation_hash,endpoint_hash,endpoint,p256dh,auth_secret,active)
        VALUES(:id,:owner,:version,:generation,:hash,:endpoint,:key,:auth,true)
        ON CONFLICT(endpoint_hash) DO UPDATE SET auth_version=excluded.auth_version,generation_hash=excluded.generation_hash,
        endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth_secret=excluded.auth_secret,active=true
        WHERE browser_push_subscriptions.account_id=excluded.account_id RETURNING id""",
        nativeQuery = true,
    )
    fun upsert(
        id: UUID,
        owner: UUID,
        version: Long,
        generation: String,
        hash: String,
        endpoint: String,
        key: String,
        auth: String,
    ): UUID?

    @Modifying
    @Query(
        "update PushSubscriptionEntity s set s.active=false where s.id=:id and s.accountId=:owner and s.active=true"
    )
    fun deactivate(id: UUID, owner: UUID): Int

    fun existsByIdAndAccountIdAndAuthVersionAndGenerationHashAndActiveTrue(
        id: UUID,
        owner: UUID,
        version: Long,
        generation: String,
    ): Boolean
}

@Repository
class PushSubscriptionRepository(private val queries: PushSubscriptionQueries) {
    fun save(
        id: UUID,
        owner: UUID,
        version: Long,
        generation: String,
        hash: String,
        input: PushSubscriptionInput,
    ): UUID? =
        queries.upsert(
            id,
            owner,
            version,
            generation,
            hash,
            input.endpoint,
            input.p256dh,
            input.auth,
        )

    @Transactional
    fun deactivate(id: UUID, owner: UUID): Boolean = queries.deactivate(id, owner) == 1

    fun active(id: UUID, owner: UUID, version: Long, generation: String): Boolean =
        queries.existsByIdAndAccountIdAndAuthVersionAndGenerationHashAndActiveTrue(
            id,
            owner,
            version,
            generation,
        )
}
