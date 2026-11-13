package ru.lastochka.scheduling.repo

import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import ru.lastochka.common.Metadata
import ru.lastochka.scheduling.dto.*
import ru.lastochka.scheduling.entity.StudioSession
import tools.jackson.databind.json.JsonMapper

interface GroupProjection {
    val id: UUID
    val version: Long
    val parameters: String
}

interface SeriesProjection {
    val id: UUID
    val groupId: UUID
    val version: Long
    val rule: String?
    val draft: String?
    val draftVersion: Long?
    val draftBaseVersion: Long?
}

interface MembershipProjection {
    val sessionId: UUID
    val groupId: UUID
    val groupName: String
    val seriesId: UUID?
    val originalDate: LocalDate?
    val exception: Boolean
    val permanent: Boolean
}

interface RecurrenceHistoryProjection {
    val id: Long
    val action: String
    val author: String
    val occurredAt: Instant
    val operationId: UUID
    val affected: Int
    val rule: String?
}

interface RecurrenceQueries : JpaRepository<StudioSession, UUID> {
    // JSONB, sequence и upsert PostgreSQL сохраняют атомарные операции и существующий формат.
    // Native SQL: сохранить обработку JSONB.
    @Query(
        value =
            "SELECT id,version,CAST(parameters AS text) AS parameters FROM schedule_groups ORDER BY parameters->>'name',id",
        nativeQuery = true,
    )
    fun groups(): List<GroupProjection>

    @Modifying
    // Native SQL: сохранить обработку JSONB.
    @Query(
        value = "INSERT INTO schedule_groups(id,parameters) VALUES(:id,CAST(:p AS jsonb))",
        nativeQuery = true,
    )
    fun insertGroup(id: UUID, p: String): Int

    @Modifying
    // Native SQL: сохранить обработку JSONB.
    @Query(
        value =
            "UPDATE schedule_groups SET parameters=CAST(:p AS jsonb),version=version+1 WHERE id=:id",
        nativeQuery = true,
    )
    fun updateGroup(id: UUID, p: String): Int

    // Native SQL: сохранить обработку JSONB.
    @Query(
        value =
            "SELECT id,group_id AS \"groupId\",version,CAST(rule AS text) AS rule,CAST(draft AS text) AS draft,draft_version AS \"draftVersion\",draft_base_version AS \"draftBaseVersion\" FROM session_series ORDER BY id",
        nativeQuery = true,
    )
    fun series(): List<SeriesProjection>

    @Modifying
    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(value = "INSERT INTO session_series(id,group_id) VALUES(:id,:group)", nativeQuery = true)
    fun insertSeries(id: UUID, group: UUID): Int

    @Modifying
    @Query(value = "INSERT INTO session_series(id,group_id,age_direction_id) VALUES(:id,:group,:direction)", nativeQuery = true)
    fun insertPermanentSeries(id: UUID, group: UUID, direction: UUID): Int

    @Modifying
    // Native SQL: сохранить обработку JSONB, использовать существующую sequence.
    @Query(
        value =
            "UPDATE session_series SET draft=CAST(:p AS jsonb),draft_version=nextval('recurrence_draft_revision'),draft_base_version=version WHERE id=:id",
        nativeQuery = true,
    )
    fun saveDraft(id: UUID, p: String): Int

    @Modifying
    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(
        value =
            "UPDATE session_series SET draft=NULL,draft_version=NULL,draft_base_version=NULL WHERE id=:id",
        nativeQuery = true,
    )
    fun discard(id: UUID): Int

    @Modifying
    // Native SQL: сохранить обработку JSONB.
    @Query(
        value =
            "UPDATE session_series SET rule=CAST(:p AS jsonb),version=version+1,draft=NULL,draft_version=NULL,draft_base_version=NULL WHERE id=:id",
        nativeQuery = true,
    )
    fun publish(id: UUID, p: String): Int

    // Native SQL: сохранить обработку JSONB, сохранить соединение таблиц владельцев.
    @Query(
        value =
            "SELECT l.session_id AS \"sessionId\",l.group_id AS \"groupId\",g.parameters->>'name' AS \"groupName\",l.series_id AS \"seriesId\",l.original_date AS \"originalDate\",l.is_exception AS exception,EXISTS(SELECT 1 FROM permanent_series p WHERE p.series_id=l.series_id) AS permanent FROM session_group_links l JOIN schedule_groups g ON g.id=l.group_id ORDER BY l.session_id",
        nativeQuery = true,
    )
    fun memberships(): List<MembershipProjection>

    @Query(
        value = """
            SELECT l.session_id AS "sessionId",l.group_id AS "groupId",
                   g.parameters->>'name' AS "groupName",l.series_id AS "seriesId",
                   l.original_date AS "originalDate",l.is_exception AS exception,
                   EXISTS(SELECT 1 FROM permanent_series p WHERE p.series_id=l.series_id) AS permanent
              FROM session_group_links l JOIN schedule_groups g ON g.id=l.group_id
             WHERE l.series_id IN (:seriesIds) AND l.original_date >= :firstDate
               AND l.original_date < :lastDate
             ORDER BY l.series_id,l.original_date LIMIT 5001
        """,
        nativeQuery = true,
    )
    fun membershipsBetween(seriesIds: Collection<UUID>, firstDate: LocalDate, lastDate: LocalDate): List<MembershipProjection>

    @Modifying
    // Native SQL: сохранить атомарный upsert.
    @Query(
        value =
            "INSERT INTO session_group_links(session_id,group_id,series_id,original_date) VALUES(:id,:group,:series,:date) ON CONFLICT(session_id) DO UPDATE SET group_id=excluded.group_id",
        nativeQuery = true,
    )
    fun link(id: UUID, group: UUID, series: UUID?, date: LocalDate?): Int

    @Modifying
    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(
        value = "DELETE FROM session_group_links WHERE session_id=:id AND series_id IS NULL",
        nativeQuery = true,
    )
    fun unlink(id: UUID): Int

    @Modifying
    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(
        value =
            "UPDATE session_group_links SET is_exception=true WHERE session_id=:id AND series_id IS NOT NULL",
        nativeQuery = true,
    )
    fun exception(id: UUID): Int

    @Modifying
    // Native SQL: сохранить SQL-операции PostgreSQL.
    @Query(
        value =
            "UPDATE session_series SET version=version+1 WHERE id IN (SELECT series_id FROM session_group_links WHERE session_id=:id)",
        nativeQuery = true,
    )
    fun touch(id: UUID): Int

    @Query(
        "select s.id from StudioSession s where s.status in :statuses and s.startsAt<:to and s.endsAt>:from order by s.startsAt,s.id"
    )
    fun busyIds(from: Instant, to: Instant, statuses: Collection<String>): List<UUID>

    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(
        value = "SELECT session_id FROM session_edit_drafts WHERE session_id IN (:ids)",
        nativeQuery = true,
    )
    fun draftIds(ids: List<UUID>): List<UUID>

    // История объединяет данные владельцев без импорта чужих сущностей.
    // Native SQL: сохранить обработку JSONB, сохранить соединение таблиц владельцев.
    @Query(
        value =
            "SELECT h.id,h.action,a.name AS author,h.occurred_at AS \"occurredAt\",h.operation_id AS \"operationId\",h.affected,CAST(h.rule AS text) AS rule FROM recurrence_history h JOIN accounts a ON a.id=h.actor_id WHERE h.aggregate_id=:id ORDER BY h.id DESC LIMIT :size OFFSET :offset",
        nativeQuery = true,
    )
    fun history(id: UUID, size: Int, offset: Long): List<RecurrenceHistoryProjection>

    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(
        value = "SELECT count(*) FROM recurrence_history WHERE aggregate_id=:id",
        nativeQuery = true,
    )
    fun countHistory(id: UUID): Long

    @Modifying
    // Native SQL: сохранить обработку JSONB.
    @Query(
        value =
            "INSERT INTO recurrence_history(aggregate_id,actor_id,action,operation_id,rule,affected) VALUES(:id,:actor,:action,:operation,CAST(:rule AS jsonb),:affected)",
        nativeQuery = true,
    )
    fun audit(
        id: UUID,
        actor: UUID,
        action: String,
        operation: UUID,
        rule: String?,
        affected: Int,
    ): Int
}

@Repository
class RecurrenceRepository(private val queries: RecurrenceQueries, private val json: JsonMapper) {
    fun groups(): List<ScheduleGroupView> =
        queries.groups().map {
            ScheduleGroupView(
                it.id,
                it.version,
                json.readValue(it.parameters, ScheduleGroupInput::class.java),
            )
        }

    fun group(id: UUID) = groups().firstOrNull { it.id == id }

    fun createPermanentSeries(id: UUID, group: UUID, direction: UUID) {
        queries.insertPermanentSeries(id, group, direction)
    }

    fun saveGroup(id: UUID, input: ScheduleGroupInput, create: Boolean) {
        val p = json.writeValueAsString(input)
        if (create) queries.insertGroup(id, p) else queries.updateGroup(id, p)
    }

    fun series(): List<SessionSeriesView> =
        queries.series().map {
            SessionSeriesView(
                it.id,
                it.groupId,
                it.version,
                it.rule?.let { raw -> json.readValue(raw, SeriesRule::class.java) },
                it.draft?.let { raw -> json.readValue(raw, SeriesDraftInput::class.java) },
                it.draftVersion,
                it.draftBaseVersion,
            )
        }

    fun series(id: UUID) = series().firstOrNull { it.id == id }

    fun saveDraft(id: UUID, input: SeriesDraftInput, create: Boolean) {
        if (create) queries.insertSeries(id, input.groupId)
        queries.saveDraft(id, json.writeValueAsString(input))
    }

    fun discard(id: UUID) {
        queries.discard(id)
    }

    fun publish(id: UUID, rule: SeriesRule) {
        queries.publish(id, json.writeValueAsString(rule))
    }

    fun memberships(): List<SessionMembership> =
        queries.memberships().map {
            SessionMembership(
                it.sessionId,
                it.groupId,
                it.groupName,
                it.seriesId,
                it.originalDate,
                it.exception,
                it.permanent,
            )
        }

    fun membershipsBetween(seriesIds: Collection<UUID>, firstDate: LocalDate, lastDate: LocalDate): List<SessionMembership> =
        if (seriesIds.isEmpty()) emptyList() else queries.membershipsBetween(seriesIds, firstDate, lastDate).map {
            SessionMembership(it.sessionId, it.groupId, it.groupName, it.seriesId, it.originalDate, it.exception, it.permanent)
        }

    fun link(session: UUID, group: UUID, series: UUID? = null, date: LocalDate? = null) {
        queries.link(session, group, series, date)
    }

    fun unlink(session: UUID) {
        queries.unlink(session)
    }

    fun touch(session: UUID, exception: Boolean) {
        if (exception) queries.exception(session)
        queries.touch(session)
    }

    fun busyIds(from: Instant, to: Instant): List<UUID> =
        queries.busyIds(from, to, listOf(Metadata.Scheduling.OPEN, Metadata.Scheduling.CLOSED))

    fun draftIds(ids: List<UUID>): Set<UUID> =
        if (ids.isEmpty()) emptySet() else queries.draftIds(ids).toSet()

    fun history(id: UUID, page: Int): RecurrenceHistory {
        val items =
            queries
                .history(
                    id,
                    Metadata.Editor.HISTORY_SIZE,
                    page.toLong() * Metadata.Editor.HISTORY_SIZE,
                )
                .map {
                    val rule = it.rule
                    RecurrenceHistoryEntry(
                        it.id,
                        it.action,
                        it.author,
                        it.occurredAt,
                        it.operationId,
                        it.affected,
                        rule?.let { raw ->
                            if (json.readTree(raw).has("startDate"))
                                json.readValue(raw, SeriesRule::class.java)
                            else null
                        },
                        rule?.let { raw ->
                            if (json.readTree(raw).has("name"))
                                json.readValue(raw, ScheduleGroupInput::class.java)
                            else null
                        },
                    )
                }
        return RecurrenceHistory(items, queries.countHistory(id), page)
    }

    fun audit(
        id: UUID,
        actor: UUID,
        action: String,
        operation: UUID,
        rule: SeriesRule? = null,
        affected: Int = 0,
        group: ScheduleGroupInput? = null,
    ) {
        queries.audit(
            id,
            actor,
            action,
            operation,
            (rule ?: group)?.let { json.writeValueAsString(it) },
            affected,
        )
    }
}
