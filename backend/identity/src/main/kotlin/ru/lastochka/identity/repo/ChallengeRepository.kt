package ru.lastochka.identity.repo

import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import ru.lastochka.common.Metadata

@Repository
class ChallengeRepository(
    private val clock: java.time.Clock,
    private val jdbc: JdbcClient,
) {
    fun save(sessionId: String, accountId: UUID, kind: String, payload: String) =
        jdbc
            .sql(
                "INSERT INTO webauthn_challenges(session_id,account_id,kind,payload,expires_at) VALUES (:session,:account,:kind,:payload,:until) ON CONFLICT(session_id) DO UPDATE SET account_id=excluded.account_id,kind=excluded.kind,payload=excluded.payload,expires_at=excluded.expires_at"
            )
            .param("session", sessionId)
            .param("account", accountId)
            .param("kind", kind)
            .param("payload", payload)
            .param(
                "until",
                clock
                    .instant()
                    .plusSeconds(Metadata.IdentityLimits.CHALLENGE_TTL_SECONDS)
                    .atOffset(java.time.ZoneOffset.UTC),
            )
            .update()

    fun consume(sessionId: String) =
        jdbc
            .sql(
                "DELETE FROM webauthn_challenges WHERE session_id=:session RETURNING account_id,kind,payload,expires_at"
            )
            .param("session", sessionId)
            .query { rs, _ ->
                ChallengeRecord(
                    rs.getObject("account_id", UUID::class.java),
                    rs.getString("kind"),
                    rs.getString("payload"),
                    rs.getTimestamp("expires_at").toInstant(),
                )
            }
            .optional()
            .orElse(null)
}

data class ChallengeRecord(
    val accountId: UUID,
    val kind: String,
    val payload: String,
    val expiresAt: Instant,
)
