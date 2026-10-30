package ru.lastochka.identity.repo

import java.time.Clock
import java.time.OffsetDateTime
import java.time.ZoneOffset
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import ru.lastochka.common.Metadata
import ru.lastochka.identity.entity.AuthLimit

@Repository
class RateLimitRepository(private val queries: RateLimitQueries, private val clock: Clock) {
    fun increment(bucket: String, window: Long): Int =
        queries.increment(
            bucket.take(Metadata.IdentityLimits.MAX_BUCKET_LENGTH),
            clock.instant().atOffset(ZoneOffset.UTC),
            clock.instant().plusSeconds(window).atOffset(ZoneOffset.UTC),
        )
}

interface RateLimitQueries : JpaRepository<AuthLimit, String> {
    // PostgreSQL upsert returns the atomic counter value; a read followed by a write loses
    // concurrent attempts.
    // Запрос возвращает результат, поэтому @Modifying с executeUpdate здесь не используется.
    // Native SQL: сохранить атомарный upsert, вернуть результат атомарного изменения.
    @Query(
        value =
            """INSERT INTO auth_limits(bucket,attempts,resets_at) VALUES (:bucket,1,:until)
        ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN auth_limits.resets_at<=:now THEN 1 ELSE auth_limits.attempts+1 END,
        resets_at=CASE WHEN auth_limits.resets_at<=:now THEN :until ELSE auth_limits.resets_at END RETURNING attempts""",
        nativeQuery = true,
    )
    fun increment(bucket: String, now: OffsetDateTime, until: OffsetDateTime): Int
}
