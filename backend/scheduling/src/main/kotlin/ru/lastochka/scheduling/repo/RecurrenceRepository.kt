package ru.lastochka.scheduling.repo

import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import ru.lastochka.common.Metadata
import ru.lastochka.scheduling.dto.*
import tools.jackson.databind.json.JsonMapper

@Repository
class RecurrenceRepository(private val jdbc: JdbcClient, private val json: JsonMapper) {
    fun groups(): List<ScheduleGroupView> =
        jdbc
            .sql("SELECT * FROM schedule_groups ORDER BY parameters->>'name',id")
            .query { rs, _ ->
                ScheduleGroupView(
                    rs.getObject("id", UUID::class.java),
                    rs.getLong("version"),
                    json.readValue(rs.getString("parameters"), ScheduleGroupInput::class.java),
                )
            }
            .list()

    fun group(id: UUID) = groups().firstOrNull { it.id == id }

    fun saveGroup(id: UUID, input: ScheduleGroupInput, create: Boolean) {
        val sql =
            if (create) "INSERT INTO schedule_groups(id,parameters) VALUES(:id,CAST(:p AS jsonb))"
            else
                "UPDATE schedule_groups SET parameters=CAST(:p AS jsonb),version=version+1 WHERE id=:id"
        jdbc.sql(sql).param("id", id).param("p", json.writeValueAsString(input)).update()
    }

    fun series(): List<SessionSeriesView> =
        jdbc
            .sql("SELECT * FROM session_series ORDER BY id")
            .query { rs, _ ->
                SessionSeriesView(
                    rs.getObject("id", UUID::class.java),
                    rs.getObject("group_id", UUID::class.java),
                    rs.getLong("version"),
                    rs.getString("rule")?.let { json.readValue(it, SeriesRule::class.java) },
                    rs.getString("draft")?.let { json.readValue(it, SeriesDraftInput::class.java) },
                    rs.getObject("draft_version", java.lang.Long::class.java)?.toLong(),
                    rs.getObject("draft_base_version", java.lang.Long::class.java)?.toLong(),
                )
            }
            .list()

    fun series(id: UUID) = series().firstOrNull { it.id == id }

    fun saveDraft(id: UUID, input: SeriesDraftInput, create: Boolean) {
        if (create)
            jdbc
                .sql("INSERT INTO session_series(id,group_id) VALUES(:id,:group)")
                .param("id", id)
                .param("group", input.groupId)
                .update()
        jdbc
            .sql(
                "UPDATE session_series SET draft=CAST(:p AS jsonb),draft_version=nextval('recurrence_draft_revision'),draft_base_version=version WHERE id=:id"
            )
            .param("id", id)
            .param("p", json.writeValueAsString(input))
            .update()
    }

    fun discard(id: UUID) {
        jdbc
            .sql(
                "UPDATE session_series SET draft=NULL,draft_version=NULL,draft_base_version=NULL WHERE id=:id"
            )
            .param("id", id)
            .update()
    }

    fun publish(id: UUID, rule: SeriesRule) {
        jdbc
            .sql(
                "UPDATE session_series SET rule=CAST(:p AS jsonb),version=version+1,draft=NULL,draft_version=NULL,draft_base_version=NULL WHERE id=:id"
            )
            .param("p", json.writeValueAsString(rule))
            .param("id", id)
            .update()
    }

    fun memberships(): List<SessionMembership> =
        jdbc
            .sql(
                "SELECT l.*,g.parameters->>'name' AS group_name FROM session_group_links l JOIN schedule_groups g ON g.id=l.group_id ORDER BY l.session_id"
            )
            .query { rs, _ ->
                SessionMembership(
                    rs.getObject("session_id", UUID::class.java),
                    rs.getObject("group_id", UUID::class.java),
                    rs.getString("group_name"),
                    rs.getObject("series_id", UUID::class.java),
                    rs.getObject("original_date", LocalDate::class.java),
                    rs.getBoolean("is_exception"),
                )
            }
            .list()

    fun link(session: UUID, group: UUID, series: UUID? = null, date: LocalDate? = null) {
        jdbc
            .sql(
                "INSERT INTO session_group_links(session_id,group_id,series_id,original_date) VALUES(:id,:group,:series,:date) ON CONFLICT(session_id) DO UPDATE SET group_id=excluded.group_id"
            )
            .param("id", session)
            .param("group", group)
            .param("series", series)
            .param("date", date)
            .update()
    }

    fun unlink(session: UUID) {
        jdbc
            .sql("DELETE FROM session_group_links WHERE session_id=:id AND series_id IS NULL")
            .param("id", session)
            .update()
    }

    fun touch(session: UUID, exception: Boolean) {
        if (exception)
            jdbc
                .sql(
                    "UPDATE session_group_links SET is_exception=true WHERE session_id=:id AND series_id IS NOT NULL"
                )
                .param("id", session)
                .update()
        jdbc
            .sql(
                "UPDATE session_series SET version=version+1 WHERE id IN (SELECT series_id FROM session_group_links WHERE session_id=:id)"
            )
            .param("id", session)
            .update()
    }

    fun busyIds(from: Instant, to: Instant): List<UUID> =
        jdbc
            .sql(
                "SELECT id FROM studio_sessions WHERE status IN ('OPEN','CLOSED') AND starts_at<:to AND ends_at>:from ORDER BY starts_at,id"
            )
            .param("from", from.atOffset(ZoneOffset.UTC))
            .param("to", to.atOffset(ZoneOffset.UTC))
            .query(UUID::class.java)
            .list()
            .filterNotNull()

    fun draftIds(ids: List<UUID>): Set<UUID> =
        if (ids.isEmpty()) emptySet()
        else
            jdbc
                .sql("SELECT session_id FROM session_edit_drafts WHERE session_id IN (:ids)")
                .param("ids", ids)
                .query(UUID::class.java)
                .list()
                .filterNotNull()
                .toSet()

    fun history(id: UUID, page: Int): RecurrenceHistory {
        val items =
            jdbc
                .sql(
                    "SELECT h.*,a.name AS author FROM recurrence_history h JOIN accounts a ON a.id=h.actor_id WHERE aggregate_id=:id ORDER BY h.id DESC LIMIT :size OFFSET :offset"
                )
                .param("id", id)
                .param("size", Metadata.Editor.HISTORY_SIZE)
                .param("offset", page.toLong() * Metadata.Editor.HISTORY_SIZE)
                .query { rs, _ ->
                    RecurrenceHistoryEntry(
                        rs.getLong("id"),
                        rs.getString("action"),
                        rs.getString("author"),
                        rs.getObject("occurred_at", OffsetDateTime::class.java).toInstant(),
                        rs.getObject("operation_id", UUID::class.java),
                        rs.getInt("affected"),
                        rs.getString("rule")?.let {
                            if (json.readTree(it).has("startDate"))
                                json.readValue(it, SeriesRule::class.java)
                            else null
                        },
                        rs.getString("rule")?.let {
                            if (json.readTree(it).has("name"))
                                json.readValue(it, ScheduleGroupInput::class.java)
                            else null
                        },
                    )
                }
                .list()
        val total =
            jdbc
                .sql("SELECT count(*) FROM recurrence_history WHERE aggregate_id=:id")
                .param("id", id)
                .query(Long::class.java)
                .single()
        return RecurrenceHistory(items, total, page)
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
        jdbc
            .sql(
                "INSERT INTO recurrence_history(aggregate_id,actor_id,action,operation_id,rule,affected) VALUES(:id,:actor,:action,:operation,CAST(:rule AS jsonb),:affected)"
            )
            .param("id", id)
            .param("actor", actor)
            .param("action", action)
            .param("operation", operation)
            .param("rule", (rule ?: group)?.let { json.writeValueAsString(it) })
            .param("affected", affected)
            .update()
    }
}
