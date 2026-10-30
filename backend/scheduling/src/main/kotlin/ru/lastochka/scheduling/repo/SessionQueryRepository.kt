package ru.lastochka.scheduling.repo

import java.time.Clock
import java.time.Instant
import java.util.UUID
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import ru.lastochka.common.Metadata
import ru.lastochka.scheduling.entity.StudioSession

interface SessionQueries : JpaRepository<StudioSession, UUID> {
    @Query(
        "select s.id from StudioSession s where s.startsAt<:to and s.endsAt>:from order by s.startsAt,s.id"
    )
    fun calendarIds(from: Instant, to: Instant, page: Pageable): List<UUID>

    @Query(
        "select count(s) from StudioSession s where s.id<>:id and s.status in :statuses and s.startsAt<:to and s.endsAt>:from"
    )
    fun overlaps(id: UUID, from: Instant, to: Instant, statuses: Collection<String>): Long

    @Query(
        "select s.id from StudioSession s where s.startsAt>=:from and s.startsAt<:to and (:admin=true or (s.startsAt>:now and (s.status=:open or (:selectable=false and s.status=:closed)))) order by s.startsAt,s.id"
    )
    fun ids(
        from: Instant,
        to: Instant,
        now: Instant,
        admin: Boolean,
        selectable: Boolean,
        open: String,
        closed: String,
        page: Pageable,
    ): List<UUID>

    @Query(
        "select count(s) from StudioSession s where s.startsAt>=:from and s.startsAt<:to and (:admin=true or (s.startsAt>:now and (s.status=:open or (:selectable=false and s.status=:closed))))"
    )
    fun total(
        from: Instant,
        to: Instant,
        now: Instant,
        admin: Boolean,
        selectable: Boolean,
        open: String,
        closed: String,
    ): Long
}

@Repository
class SessionQueryRepository(private val queries: SessionQueries, private val clock: Clock) {
    fun calendarIds(from: Instant, to: Instant): List<UUID> =
        queries.calendarIds(
            from,
            to,
            PageRequest.of(0, Metadata.SchedulingLimits.MAX_CALENDAR_SESSIONS + 1),
        )

    fun countOverlaps(id: UUID, from: Instant, to: Instant): Int =
        queries
            .overlaps(id, from, to, listOf(Metadata.Scheduling.OPEN, Metadata.Scheduling.CLOSED))
            .toInt()

    fun findPage(
        from: Instant,
        to: Instant,
        page: Int,
        size: Int,
        admin: Boolean,
        selectable: Boolean = false,
    ): Pair<List<UUID>, Long> {
        val now = clock.instant()
        return queries.ids(
            from,
            to,
            now,
            admin,
            selectable,
            Metadata.Scheduling.OPEN,
            Metadata.Scheduling.CLOSED,
            PageRequest.of(page, size),
        ) to
            queries.total(
                from,
                to,
                now,
                admin,
                selectable,
                Metadata.Scheduling.OPEN,
                Metadata.Scheduling.CLOSED,
            )
    }
}
