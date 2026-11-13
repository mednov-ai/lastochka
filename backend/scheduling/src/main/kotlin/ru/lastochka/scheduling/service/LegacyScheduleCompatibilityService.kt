package ru.lastochka.scheduling.service

import java.time.Instant
import java.time.ZoneId
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Isolation
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.conflict
import ru.lastochka.scheduling.repo.PermanentScheduleRepository

/** Legacy UUID-only clients must not mistake unmaterialized recurring dates for an empty week. */
@Service
class LegacyScheduleCompatibilityService(
    private val sessions: SchedulingService,
    private val projection: PermanentScheduleProjectionService,
    private val permanent: PermanentScheduleRepository,
) {
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    fun list(from: Instant, to: Instant, page: Int, size: Int, selectable: Boolean) =
        sessions.list(from, to, page, size, false, selectable).also {
            val zone = ZoneId.of(Metadata.Time.STUDIO_ZONE)
            val revisions = permanent.revisionsIn(from.atZone(zone).toLocalDate(), to.atZone(zone).toLocalDate().plusDays(1))
            if (revisions.isNotEmpty() && projection.page(from, to, 0, 1, selectable).containsCalculated)
                conflict(Metadata.ErrorCodes.SCHEDULE_UPDATE_REQUIRED)
        }
}
