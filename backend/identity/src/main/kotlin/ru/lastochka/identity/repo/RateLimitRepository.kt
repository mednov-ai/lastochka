package ru.lastochka.identity.repo

import java.time.Clock
import java.time.ZoneOffset
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import ru.lastochka.common.Metadata

@Repository
class RateLimitRepository(private val jdbc: JdbcClient, private val clock: Clock) {
    fun increment(bucket: String, window: Long) =
        jdbc
            .sql(
                """INSERT INTO auth_limits(bucket,attempts,resets_at) VALUES (:bucket,1,:until)
            ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN auth_limits.resets_at<=:now THEN 1 ELSE auth_limits.attempts+1 END,
            resets_at=CASE WHEN auth_limits.resets_at<=:now THEN :until ELSE auth_limits.resets_at END RETURNING attempts"""
            )
            .param("bucket", bucket.take(Metadata.IdentityLimits.MAX_BUCKET_LENGTH))
            .param("now", clock.instant().atOffset(java.time.ZoneOffset.UTC))
            .param(
                "until",
                clock.instant().plusSeconds(window).atOffset(java.time.ZoneOffset.UTC),
            )
            .query(Int::class.java)
            .single()
}
