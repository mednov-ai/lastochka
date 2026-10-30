package ru.lastochka.scheduling.repo

import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import ru.lastochka.common.Metadata
import ru.lastochka.scheduling.dto.*
import tools.jackson.databind.json.JsonMapper

@Repository
class SessionDraftRepository(private val jdbc: JdbcClient, private val json: JsonMapper) {
    fun find(id: UUID): SessionDraftView? =
        jdbc
            .sql(
                "SELECT d.*, a.name AS author FROM session_edit_drafts d JOIN accounts a ON a.id=d.actor_id WHERE session_id=:id"
            )
            .param("id", id)
            .query { rs, _ ->
                SessionDraftView(
                    rs.getLong("version"),
                    rs.getLong("base_session_version"),
                    json.readValue(rs.getString("payload"), SessionInput::class.java),
                    rs.getObject("updated_at", OffsetDateTime::class.java).toInstant(),
                    rs.getString("author"),
                )
            }
            .optional()
            .orElse(null)

    fun save(id: UUID, actor: UUID, base: Long, input: SessionInput, now: Instant) {
        jdbc
            .sql(
                "INSERT INTO session_edit_drafts(session_id,base_session_version,payload,actor_id,updated_at) VALUES(:id,:base,CAST(:payload AS jsonb),:actor,:now) ON CONFLICT(session_id) DO UPDATE SET version=nextval('session_draft_revision'),base_session_version=excluded.base_session_version,payload=excluded.payload,actor_id=excluded.actor_id,updated_at=excluded.updated_at"
            )
            .param("id", id)
            .param("base", base)
            .param("payload", json.writeValueAsString(input))
            .param("actor", actor)
            .param("now", now.atOffset(ZoneOffset.UTC))
            .update()
    }

    fun delete(id: UUID) {
        jdbc.sql("DELETE FROM session_edit_drafts WHERE session_id=:id").param("id", id).update()
    }

    private fun parameters(raw: String?): SessionInput? {
        if (raw == null) return null
        val node = json.readTree(raw)
        val p = if (node.has("session")) node.get("session") else node
        if (!p.has("title") || !p.has("startsAt")) return null
        return SessionInput(
            p.get("title").asText(),
            p.get("format").asText(),
            Instant.parse(p.get("startsAt").asText()),
            Instant.parse(p.get("endsAt").asText()),
            p.get("capacity").asInt(),
            p.get("ageFrom")?.takeUnless { it.isNull }?.asInt(),
            p.get("ageTo")?.takeUnless { it.isNull }?.asInt(),
            true,
        )
    }

    fun history(id: UUID, page: Int): SessionHistory {
        val items =
            jdbc
                .sql(
                    "SELECT e.*,a.name AS author FROM audit_events e LEFT JOIN accounts a ON a.id=e.actor_id WHERE e.aggregate_id=:id ORDER BY e.occurred_at DESC,e.id DESC LIMIT :limit OFFSET :offset"
                )
                .param("id", id)
                .param("limit", Metadata.Editor.HISTORY_SIZE)
                .param("offset", page.toLong() * Metadata.Editor.HISTORY_SIZE)
                .query { rs, _ ->
                    SessionRevision(
                        rs.getLong("id"),
                        rs.getString("action"),
                        rs.getObject("occurred_at", OffsetDateTime::class.java).toInstant(),
                        rs.getString("author") ?: "Оператор",
                        parameters(rs.getString("before_state")),
                        parameters(rs.getString("after_state")),
                    )
                }
                .list()
        val total =
            jdbc
                .sql("SELECT count(*) FROM audit_events WHERE aggregate_id=:id")
                .param("id", id)
                .query(Long::class.java)
                .single()
        return SessionHistory(items, total, page)
    }

    fun revision(id: UUID, revision: Long): SessionInput? =
        jdbc
            .sql(
                "SELECT after_state::text FROM audit_events WHERE aggregate_id=:id AND id=:revision"
            )
            .param("id", id)
            .param("revision", revision)
            .query { rs, _ -> parameters(rs.getString(1)) }
            .optional()
            .orElse(null)
}
