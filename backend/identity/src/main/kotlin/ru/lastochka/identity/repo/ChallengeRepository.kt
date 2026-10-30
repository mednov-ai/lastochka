package ru.lastochka.identity.repo

import java.time.Clock
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import ru.lastochka.common.Metadata
import ru.lastochka.identity.entity.StoredChallenge

@Repository
class ChallengeRepository(private val clock: Clock, private val queries: ChallengeQueries) {
    fun save(sessionId: String, accountId: UUID, kind: String, payload: String): Int =
        queries.store(
            sessionId,
            accountId,
            kind,
            payload,
            clock
                .instant()
                .plusSeconds(Metadata.IdentityLimits.CHALLENGE_TTL_SECONDS)
                .atOffset(ZoneOffset.UTC),
        )

    fun consume(sessionId: String): ChallengeRecord? =
        queries.consume(sessionId)?.let {
            ChallengeRecord(it.accountId, it.kind, it.payload, it.expiresAt)
        }
}

interface ChallengeQueries : JpaRepository<StoredChallenge, String> {
    // PostgreSQL upsert сохраняет атомарную замену challenge одной сессии.
    @Modifying
    // Native SQL: сохранить атомарный upsert.
    @Query(
        value =
            """INSERT INTO webauthn_challenges(session_id,account_id,kind,payload,expires_at) VALUES (:session,:account,:kind,:payload,:until)
        ON CONFLICT(session_id) DO UPDATE SET account_id=excluded.account_id,kind=excluded.kind,payload=excluded.payload,expires_at=excluded.expires_at""",
        nativeQuery = true,
    )
    fun store(
        session: String,
        account: UUID,
        kind: String,
        payload: String,
        until: OffsetDateTime,
    ): Int

    // DELETE RETURNING обеспечивает одноразовое использование при конкурирующих запросах.
    // Native SQL: вернуть результат атомарного изменения.
    @Query(
        value =
            "DELETE FROM webauthn_challenges WHERE session_id=:session RETURNING session_id,account_id,kind,payload,expires_at",
        nativeQuery = true,
    )
    fun consume(session: String): StoredChallenge?
}

data class ChallengeRecord(
    val accountId: UUID,
    val kind: String,
    val payload: String,
    val expiresAt: Instant,
)
