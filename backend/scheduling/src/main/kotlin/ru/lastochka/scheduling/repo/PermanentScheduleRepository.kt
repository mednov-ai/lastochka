package ru.lastochka.scheduling.repo

import java.time.LocalDate
import java.time.Instant
import java.time.LocalTime
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import ru.lastochka.scheduling.entity.StudioSession

interface PermanentRevisionProjection {
    val seriesId: UUID
    val seriesVersion: Long
    val revision: Long
    val effectiveFrom: LocalDate
    val effectiveUntil: LocalDate?
    val weekday: Int
    val startTime: LocalTime
    val durationMinutes: Int
    val directionId: UUID
    val title: String
    val capacity: Int
    val ageFrom: Int
    val ageTo: Int?
    val ageOpenEnded: Boolean
}

interface PermanentBusyProjection {
    val id: UUID
    val startsAt: Instant
    val endsAt: Instant
}

/**
 * Persistence primitives only. Writers must hold the shared studio lock and validate the whole
 * plan.
 */
interface PermanentScheduleRepository : JpaRepository<StudioSession, UUID> {
    @Query(value = "SELECT series_id FROM permanent_series", nativeQuery = true)
    fun permanentSeriesIds(): List<UUID>

    @Query(value = "SELECT EXISTS (SELECT 1 FROM session_group_links l JOIN permanent_series p ON p.series_id=l.series_id WHERE l.session_id=:sessionId)", nativeQuery = true)
    fun isPermanentSession(sessionId: UUID): Boolean

    @Query(value = "SELECT id,starts_at AS \"startsAt\",ends_at AS \"endsAt\" FROM studio_sessions WHERE status IN ('OPEN','CLOSED','DRAFT') AND ends_at > :now ORDER BY starts_at,id LIMIT 5001", nativeQuery = true)
    fun busyFuture(now: Instant): List<PermanentBusyProjection>

    @Query(value = "SELECT CAST(payload AS text) FROM session_edit_drafts ORDER BY session_id LIMIT 5001", nativeQuery = true)
    fun sessionDraftPayloads(): List<String>

    @Query(value = "SELECT CAST(draft AS text) FROM session_series WHERE draft IS NOT NULL ORDER BY id LIMIT 5001", nativeQuery = true)
    fun seriesDraftPayloads(): List<String>

    @Query(value = "SELECT EXISTS (SELECT 1 FROM session_series WHERE id=:seriesId AND draft IS NOT NULL)", nativeQuery = true)
    fun hasSeriesDraft(seriesId: UUID): Boolean
    @Query(
        value =
            """
            SELECT r.series_id AS "seriesId", p.revision AS "seriesVersion", r.revision,
                   r.effective_from AS "effectiveFrom", r.effective_until AS "effectiveUntil",
                   r.weekday, r.start_time AS "startTime", r.duration_minutes AS "durationMinutes",
                   r.direction_id AS "directionId", r.title, r.capacity, r.age_from AS "ageFrom",
                   r.age_to AS "ageTo", r.age_open_ended AS "ageOpenEnded"
              FROM permanent_series_revisions r JOIN permanent_series p ON p.series_id=r.series_id
             WHERE NOT r.superseded AND r.effective_from < :windowEnd
               AND (r.effective_until IS NULL OR r.effective_until > :windowStart)
             ORDER BY r.series_id, r.effective_from LIMIT 5001
        """,
        nativeQuery = true,
    )
    fun revisionsIn(windowStart: LocalDate, windowEnd: LocalDate): List<PermanentRevisionProjection>

    @Query(
        value = "SELECT revision FROM permanent_series WHERE series_id=:seriesId",
        nativeQuery = true,
    )
    fun permanentRevision(seriesId: UUID): Long?

    @Modifying
    @Query(value = "INSERT INTO permanent_series(series_id) VALUES(:seriesId)", nativeQuery = true)
    fun addPermanentSeries(seriesId: UUID): Int

    @Modifying
    @Query(
        value =
            "UPDATE permanent_series SET revision=revision+1 WHERE series_id=:seriesId AND revision=:expectedRevision",
        nativeQuery = true,
    )
    fun advanceRevision(seriesId: UUID, expectedRevision: Long): Int

    @Modifying
    @Query(value = "UPDATE session_series SET age_direction_id=:directionId,version=version+1 WHERE id=:seriesId", nativeQuery = true)
    fun updateDirection(seriesId: UUID, directionId: UUID): Int

    @Modifying
    @Query(
        value =
            """
            UPDATE permanent_series_revisions SET superseded=true
             WHERE series_id=:seriesId AND NOT superseded AND effective_from >= :boundary
        """,
        nativeQuery = true,
    )
    fun supersedeFuture(seriesId: UUID, boundary: LocalDate): Int

    @Modifying
    @Query(
        value =
            """
            UPDATE permanent_series_revisions SET effective_until=:boundary
             WHERE series_id=:seriesId AND NOT superseded AND effective_from < :boundary
               AND (effective_until IS NULL OR effective_until > :boundary)
        """,
        nativeQuery = true,
    )
    fun endCurrentAt(seriesId: UUID, boundary: LocalDate): Int

    @Modifying
    @Query(
        value =
            """
            INSERT INTO permanent_series_revisions(
              series_id,revision,effective_from,effective_until,weekday,start_time,duration_minutes,
              direction_id,title,capacity,age_from,age_to,age_open_ended
            ) VALUES (
              :seriesId,:revision,:effectiveFrom,:effectiveUntil,:weekday,:startTime,:durationMinutes,
              :directionId,:title,:capacity,:ageFrom,:ageTo,:ageOpenEnded
            )
        """,
        nativeQuery = true,
    )
    fun addRevision(
        seriesId: UUID,
        revision: Long,
        effectiveFrom: LocalDate,
        effectiveUntil: LocalDate?,
        weekday: Int,
        startTime: LocalTime,
        durationMinutes: Int,
        directionId: UUID,
        title: String,
        capacity: Int,
        ageFrom: Int,
        ageTo: Int?,
        ageOpenEnded: Boolean,
    ): Int
}
