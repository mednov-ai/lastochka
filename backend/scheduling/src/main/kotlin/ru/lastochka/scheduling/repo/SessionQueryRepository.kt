package ru.lastochka.scheduling.repo

import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.UUID
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import ru.lastochka.common.Metadata
import ru.lastochka.scheduling.dto.*

@Repository
class SessionQueryRepository(private val jdbc: JdbcClient, private val clock: Clock) {
    fun calendarIds(from: Instant, to: Instant) =
        jdbc
            .sql(
                "SELECT id FROM studio_sessions WHERE starts_at<:to AND ends_at>:from ORDER BY starts_at,id LIMIT 1001"
            )
            .param("from", from.atOffset(java.time.ZoneOffset.UTC))
            .param("to", to.atOffset(java.time.ZoneOffset.UTC))
            .query(UUID::class.java)
            .list()

    fun countOverlaps(id: UUID, from: Instant, to: Instant) =
        jdbc
            .sql(
                "SELECT count(*) FROM studio_sessions WHERE id<>:id AND status IN ('${Metadata.Scheduling.OPEN}','${Metadata.Scheduling.CLOSED}') AND starts_at<:to AND ends_at>:from"
            )
            .param("id", id)
            .param("from", from.atOffset(java.time.ZoneOffset.UTC))
            .param("to", to.atOffset(java.time.ZoneOffset.UTC))
            .query(Int::class.java)
            .single()

    fun findPage(
        from: Instant,
        to: Instant,
        page: Int,
        size: Int,
        admin: Boolean,
        selectable: Boolean = false,
    ): Pair<List<UUID>, Long> {
        // Date filtering and stable pagination stay in PostgreSQL, not in memory.
        val visibility =
            if (admin) ""
            else if (selectable) " AND status='OPEN' AND starts_at>:now"
            else " AND status IN ('OPEN','CLOSED') AND starts_at>:now"
        val params =
            mapOf(
                "from" to from.atOffset(java.time.ZoneOffset.UTC),
                "to" to to.atOffset(java.time.ZoneOffset.UTC),
                "now" to clock.instant().atOffset(java.time.ZoneOffset.UTC),
                "limit" to size,
                "offset" to page.toLong() * size,
            )
        val ids =
            jdbc
                .sql(
                    "SELECT id FROM studio_sessions WHERE starts_at>=:from AND starts_at<:to$visibility ORDER BY starts_at,id LIMIT :limit OFFSET :offset"
                )
                .params(params)
                .query(UUID::class.java)
                .list()
        val total =
            jdbc
                .sql(
                    "SELECT count(*) FROM studio_sessions WHERE starts_at>=:from AND starts_at<:to$visibility"
                )
                .params(params)
                .query(Long::class.java)
                .single()
        return ids.filterNotNull() to total
    }
}
