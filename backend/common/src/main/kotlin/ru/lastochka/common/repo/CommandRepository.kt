package ru.lastochka.common.repo

import java.time.Clock
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import ru.lastochka.common.Metadata
import ru.lastochka.common.entity.StudioSettingsEntity

interface ReplayProjection {
    val requestHash: String
    val response: String
}

interface CommandQueries : JpaRepository<StudioSettingsEntity, Int> {
    // Блокировка общей строки сохраняет прежний порядок сериализации команд.
    // Native SQL: сохранить блокировку PostgreSQL.
    @Query(value = "SELECT id FROM studio_settings WHERE id=1 FOR UPDATE", nativeQuery = true)
    fun lockStudio(): Int

    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(
        value =
            "SELECT request_hash AS \"requestHash\",response FROM idempotency_records WHERE actor_id=:actor AND operation=:operation AND key=:key AND expires_at>:now",
        nativeQuery = true,
    )
    fun replay(actor: UUID, operation: String, key: String, now: OffsetDateTime): ReplayProjection?

    // PostgreSQL upsert сохраняет атомарность и прежнюю семантику повтора.
    @Modifying
    // Native SQL: сохранить атомарный upsert.
    @Query(
        value =
            "INSERT INTO idempotency_records(actor_id,operation,key,request_hash,response,expires_at) VALUES (:actor,:operation,:key,:hash,:response,:until) ON CONFLICT(actor_id,operation,key) DO UPDATE SET request_hash=excluded.request_hash,response=excluded.response,expires_at=excluded.expires_at",
        nativeQuery = true,
    )
    fun saveReplay(
        actor: UUID,
        operation: String,
        key: String,
        hash: String,
        response: String,
        until: OffsetDateTime,
    ): Int

    // Преобразование JSONB и значения по умолчанию оставлены в PostgreSQL.
    @Modifying
    // Native SQL: сохранить обработку JSONB.
    @Query(
        value =
            "INSERT INTO audit_events(aggregate_id,actor_id,action,occurred_at,before_state,after_state,reason) VALUES (:id,:actor,:action,:now,CAST(:before AS jsonb),CAST(:after AS jsonb),:reason)",
        nativeQuery = true,
    )
    fun appendAudit(
        id: UUID,
        actor: UUID?,
        action: String,
        now: OffsetDateTime,
        before: String?,
        after: String?,
        reason: String?,
    ): Int
}

@Repository
class CommandRepository(private val queries: CommandQueries, private val clock: Clock) {
    fun lockStudio(): Int = queries.lockStudio()

    fun findReplay(actor: UUID, operation: String, key: String): ReplayRecord? =
        queries.replay(actor, operation, key, clock.instant().atOffset(ZoneOffset.UTC))?.let {
            ReplayRecord(it.requestHash, it.response)
        }

    fun saveReplay(
        actor: UUID,
        operation: String,
        key: String,
        hash: String,
        response: String,
    ): Int =
        queries.saveReplay(
            actor,
            operation,
            key,
            hash,
            response,
            clock
                .instant()
                .plusSeconds(Metadata.Commands.REPLAY_TTL_SECONDS)
                .atOffset(ZoneOffset.UTC),
        )

    fun appendAudit(
        id: UUID,
        actor: UUID?,
        action: String,
        before: String?,
        after: String?,
        reason: String?,
    ): Int =
        queries.appendAudit(
            id,
            actor,
            action,
            clock.instant().atOffset(ZoneOffset.UTC),
            before,
            after,
            reason,
        )
}

data class ReplayRecord(val requestHash: String, val response: String)
