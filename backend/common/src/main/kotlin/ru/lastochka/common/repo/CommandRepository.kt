package ru.lastochka.common.repo

import java.time.Clock
import java.time.ZoneOffset
import java.util.UUID
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import ru.lastochka.common.Metadata

@Repository
class CommandRepository(private val jdbc: JdbcClient, private val clock: Clock) {
    fun lockStudio() =
        jdbc
            .sql("SELECT id FROM studio_settings WHERE id=1 FOR UPDATE")
            .query(Int::class.java)
            .single()

    fun findReplay(actor: UUID, operation: String, key: String) =
        jdbc
            .sql(
                "SELECT request_hash,response FROM idempotency_records WHERE actor_id=:actor AND operation=:operation AND key=:key AND expires_at>:now"
            )
            .param("actor", actor)
            .param("operation", operation)
            .param("key", key)
            .param("now", clock.instant().atOffset(java.time.ZoneOffset.UTC))
            .query { rs, _ -> ReplayRecord(rs.getString("request_hash"), rs.getString("response")) }
            .optional()
            .orElse(null)

    fun saveReplay(actor: UUID, operation: String, key: String, hash: String, response: String) =
        jdbc
            .sql(
                "INSERT INTO idempotency_records(actor_id,operation,key,request_hash,response,expires_at) VALUES (:actor,:operation,:key,:hash,:response,:until) ON CONFLICT(actor_id,operation,key) DO UPDATE SET request_hash=excluded.request_hash,response=excluded.response,expires_at=excluded.expires_at"
            )
            .param("actor", actor)
            .param("operation", operation)
            .param("key", key)
            .param("hash", hash)
            .param("response", response)
            .param(
                "until",
                clock
                    .instant()
                    .plusSeconds(Metadata.Commands.REPLAY_TTL_SECONDS)
                    .atOffset(java.time.ZoneOffset.UTC),
            )
            .update()

    fun appendAudit(
        id: UUID,
        actor: UUID?,
        action: String,
        before: String?,
        after: String?,
        reason: String?,
    ) =
        jdbc
            .sql(
                "INSERT INTO audit_events(aggregate_id,actor_id,action,occurred_at,before_state,after_state,reason) VALUES (:id,:actor,:action,:now,CAST(:before AS jsonb),CAST(:after AS jsonb),:reason)"
            )
            .param("id", id)
            .param("actor", actor, java.sql.Types.OTHER)
            .param("action", action)
            .param("now", clock.instant().atOffset(java.time.ZoneOffset.UTC))
            .param("before", before, java.sql.Types.VARCHAR)
            .param("after", after, java.sql.Types.VARCHAR)
            .param("reason", reason, java.sql.Types.VARCHAR)
            .update()
}

data class ReplayRecord(val requestHash: String, val response: String)
