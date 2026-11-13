package ru.lastochka.scheduling.service

import java.time.Clock
import java.time.Duration
import org.slf4j.LoggerFactory
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Isolation
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.identity.service.ConceptStateService
import ru.lastochka.scheduling.dto.CalculatedSessionView

/** A bounded snapshot: gather first, then materialize outside this read transaction. */
@Service
class PermanentExtensionCandidates(
    private val projection: PermanentScheduleProjectionService,
    private val clock: Clock,
) {
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    fun next(limit: Int, deferred: Set<Pair<java.util.UUID, java.time.LocalDate>> = emptySet()): List<CalculatedSessionView> {
        require(limit in 1..Metadata.PermanentSchedule.EXTENSION_BATCH)
        val now = clock.instant()
        val end = now.plus(Duration.ofDays(Metadata.PermanentSchedule.EXTENSION_DAYS))
        return projection.extensionCandidates(now, end, limit, deferred)
    }
}

@Service
class PermanentScheduleExtension(
    private val concept: ConceptStateService,
    private val candidates: PermanentExtensionCandidates,
    private val occurrence: PermanentOccurrenceService,
) {
    private val log = LoggerFactory.getLogger(javaClass)
    private val deferred = mutableSetOf<Pair<java.util.UUID, java.time.LocalDate>>()

    /** A failed/stale occurrence is retried in a later batch; no surrounding batch transaction. */
    @Synchronized
    fun extend(limit: Int = Metadata.PermanentSchedule.EXTENSION_BATCH): Int {
        require(limit in 1..Metadata.PermanentSchedule.EXTENSION_BATCH)
        if (concept.mode() != Metadata.Concept.PERMANENT_SCHEDULE_MODE) return 0
        val selected = candidates.next(limit, deferred)
        if (selected.isEmpty() && deferred.isNotEmpty()) {
            deferred.clear()
            return 0
        }
        for (item in selected) {
            try {
                occurrence.materialize(item.seriesId, item.originalDate, item.seriesVersion)
            } catch (error: RuntimeException) {
                deferred.add(item.seriesId to item.originalDate)
                log.warn("Could not extend a permanent schedule occurrence", error)
            }
        }
        return selected.size
    }
}

/** Independent of notification and payment workers; no work occurs before the compatibility transition. */
@Component
@ConditionalOnProperty(name = ["lastochka.schedule-extension.enabled"], havingValue = "true", matchIfMissing = true)
class PermanentScheduleExtensionWorker(private val extension: PermanentScheduleExtension) {
    @Scheduled(
        fixedDelayString = "\${lastochka.schedule-extension.delay-ms:600000}",
        initialDelayString = "\${lastochka.schedule-extension.initial-delay-ms:60000}",
    )
    fun extend() { extension.extend() }
}
