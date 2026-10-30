package ru.lastochka.notifications.repo

import java.util.UUID
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import ru.lastochka.notifications.dto.PushSubscriptionInput

@Repository
class PushSubscriptionRepository(private val jdbc: JdbcClient) {
    fun save(
        id: UUID,
        owner: UUID,
        version: Long,
        generation: String,
        hash: String,
        input: PushSubscriptionInput,
    ): UUID? =
        jdbc
            .sql(
                """INSERT INTO browser_push_subscriptions(id,account_id,auth_version,generation_hash,endpoint_hash,endpoint,p256dh,auth_secret,active)
            VALUES(:id,:owner,:version,:generation,:hash,:endpoint,:key,:auth,true)
            ON CONFLICT(endpoint_hash) DO UPDATE SET auth_version=excluded.auth_version,generation_hash=excluded.generation_hash,
            endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth_secret=excluded.auth_secret,active=true
            WHERE browser_push_subscriptions.account_id=excluded.account_id RETURNING id"""
            )
            .params(
                mapOf(
                    "id" to id,
                    "owner" to owner,
                    "version" to version,
                    "generation" to generation,
                    "hash" to hash,
                    "endpoint" to input.endpoint,
                    "key" to input.p256dh,
                    "auth" to input.auth,
                )
            )
            .query(UUID::class.java)
            .optional()
            .orElse(null)

    fun deactivate(id: UUID, owner: UUID): Boolean =
        jdbc
            .sql(
                "UPDATE browser_push_subscriptions SET active=false WHERE id=:id AND account_id=:owner AND active"
            )
            .param("id", id)
            .param("owner", owner)
            .update() == 1

    fun active(id: UUID, owner: UUID, version: Long, generation: String): Boolean =
        jdbc
            .sql(
                "SELECT id FROM browser_push_subscriptions WHERE id=:id AND account_id=:owner AND auth_version=:version AND generation_hash=:generation AND active"
            )
            .param("id", id)
            .param("owner", owner)
            .param("version", version)
            .param("generation", generation)
            .query(UUID::class.java)
            .optional()
            .isPresent
}
