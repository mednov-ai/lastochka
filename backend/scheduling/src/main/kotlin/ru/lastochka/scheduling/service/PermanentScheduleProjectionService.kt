package ru.lastochka.scheduling.service

import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.LocalDate
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.HexFormat
import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Isolation
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.badRequest
import ru.lastochka.common.error.conflict
import ru.lastochka.scheduling.dto.CalculatedSessionView
import ru.lastochka.scheduling.dto.ProjectedSchedulePage
import ru.lastochka.scheduling.dto.ScheduleOccurrenceView
import ru.lastochka.scheduling.dto.ScheduleOccurrenceKind
import ru.lastochka.scheduling.repo.PermanentScheduleRepository
import ru.lastochka.scheduling.repo.RecurrenceRepository
import ru.lastochka.scheduling.repo.SessionQueryRepository

/** Read-only versioned contract, consistent across real and calculated dates. */
@Service
class PermanentScheduleProjectionService(
    private val permanent: PermanentScheduleRepository,
    private val recurrence: RecurrenceRepository,
    private val query: SessionQueryRepository,
    private val sessions: SchedulingService,
    private val clock: Clock,
) {
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    fun page(
        from: Instant,
        to: Instant,
        page: Int,
        size: Int,
        selectable: Boolean,
    ): ProjectedSchedulePage = pageResult(from, to, page, size, selectable, false)

    /** Historical calculated slots are plans, not confirmed session records. */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    fun adminPage(from: Instant, to: Instant, page: Int, size: Int): ProjectedSchedulePage =
        pageResult(from, to, page, size, false, true)

    private fun pageResult(from: Instant, to: Instant, page: Int, size: Int,
        selectable: Boolean, includePastCalculated: Boolean): ProjectedSchedulePage {
        if (page < 0 || size !in 1..Metadata.Limits.PAGE_SIZE_MAX)
            badRequest(Metadata.ErrorCodes.INVALID_RANGE)
        val result = calculate(from, to, selectable, includePastCalculated)
        val offset = page.toLong() * size
        val slice =
            if (offset >= result.size) emptyList()
            else result.subList(offset.toInt(), minOf(result.size, offset.toInt() + size))
        return ProjectedSchedulePage(
            slice.map {
                when (it) {
                    is PermanentScheduleProjection.Real ->
                        ScheduleOccurrenceView(ScheduleOccurrenceKind.SESSION, session = it.session, origin = it.origin)
                    is PermanentScheduleProjection.Calculated ->
                        ScheduleOccurrenceView(ScheduleOccurrenceKind.CALCULATED, calculated = calculated(it))
                }
            },
            page, size, result.size.toLong(), result.any { it is PermanentScheduleProjection.Calculated }, snapshot(result),
        )
    }

    private fun snapshot(items: List<PermanentScheduleProjection.Item>): String {
        val digest = MessageDigest.getInstance(Metadata.Protocol.SHA256)
        for (item in items) {
            val bytes = item.toString().toByteArray(Charsets.UTF_8)
            digest.update(ByteBuffer.allocate(Int.SIZE_BYTES).putInt(bytes.size).array())
            digest.update(bytes)
        }
        return HexFormat.of().formatHex(digest.digest())
    }

    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    fun extensionCandidates(from: Instant, to: Instant, limit: Int,
        deferred: Set<Pair<UUID, LocalDate>>): List<CalculatedSessionView> {
        require(limit in 1..Metadata.PermanentSchedule.EXTENSION_BATCH)
        return calculate(from, to, true).asSequence()
            .filterIsInstance<PermanentScheduleProjection.Calculated>()
            .filter { (it.seriesId to it.originalDate) !in deferred }
            .take(limit).map(::calculated).toList()
    }

    private fun calculated(it: PermanentScheduleProjection.Calculated) = CalculatedSessionView(
        it.seriesId, it.originalDate, it.seriesVersion, it.title, it.startsAt, it.endsAt,
        it.capacity, it.ageFrom, it.ageTo, it.ageOpenEnded,
    )

    private fun calculate(from: Instant, to: Instant, selectable: Boolean,
        includePastCalculated: Boolean = false): List<PermanentScheduleProjection.Item> {
        if (to <= from || Duration.between(from, to) > Duration.ofDays(Metadata.SchedulingLimits.MAX_SEARCH_DAYS))
            badRequest(Metadata.ErrorCodes.INVALID_RANGE)
        val now = clock.instant()
        val zone = ZoneId.of(Metadata.Time.STUDIO_ZONE)
        val first = from.atZone(zone).toLocalDate()
        val until = to.atZone(zone).toLocalDate().plusDays(1)
        val versions = permanent.revisionsIn(first, until)
        val links =
            recurrence.membershipsBetween(versions.map { it.seriesId }.distinct(), first, until)
        val ids = query.publicIdsBounded(from, to, now, selectable)
        if (versions.size > Metadata.PermanentSchedule.MAX_ITEMS || links.size > Metadata.PermanentSchedule.MAX_ITEMS || ids.size > Metadata.PermanentSchedule.MAX_ITEMS)
            conflict(Metadata.ErrorCodes.CALENDAR_RANGE_TOO_DENSE)
        val rules =
            versions.map {
                PermanentScheduleProjection.Rule(
                    it.seriesId,
                    it.seriesVersion,
                    PermanentRuleCalendar.Revision(
                        it.effectiveFrom,
                        it.effectiveUntil,
                        it.weekday,
                        it.startTime,
                        it.durationMinutes,
                    ),
                    it.title,
                    it.capacity,
                    it.ageFrom,
                    it.ageTo,
                    it.ageOpenEnded,
                )
            }
        val loaded = sessions.findMany((ids + links.map { it.sessionId }).distinct())
        return PermanentScheduleProjection.calculate(
                from,
                to,
                now,
                selectable,
                rules,
                links,
                ids.map { loaded.getValue(it) },
                loaded,
                includePastCalculated,
            )
    }
}
