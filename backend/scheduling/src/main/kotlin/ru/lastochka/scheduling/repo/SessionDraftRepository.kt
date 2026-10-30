package ru.lastochka.scheduling.repo

import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import ru.lastochka.common.Metadata
import ru.lastochka.scheduling.dto.*
import ru.lastochka.scheduling.entity.StudioSession
import tools.jackson.databind.json.JsonMapper

interface SessionDraftProjection {
    val version: Long
    val baseVersion: Long
    val payload: String
    val updatedAt: Instant
    val author: String
}

interface SessionHistoryProjection {
    val id: Long
    val action: String
    val occurredAt: Instant
    val author: String?
    val beforeState: String?
    val afterState: String?
}

interface SessionDraftQueries : JpaRepository<StudioSession, UUID> {
    // Нативные запросы читают JSONB и имя автора из таблицы другого владельца без импорта его
    // сущности.
    // Native SQL: сохранить обработку JSONB, сохранить соединение таблиц владельцев.
    @Query(
        value =
            "SELECT d.version,d.base_session_version AS \"baseVersion\",CAST(d.payload AS text) AS payload,d.updated_at AS \"updatedAt\",a.name AS author FROM session_edit_drafts d JOIN accounts a ON a.id=d.actor_id WHERE d.session_id=:id",
        nativeQuery = true,
    )
    fun draft(id: UUID): SessionDraftProjection?

    // PostgreSQL upsert и sequence обеспечивают атомарную замену и версию черновика.
    @Modifying
    // Native SQL: сохранить атомарный upsert, сохранить обработку JSONB, использовать существующую
    // sequence.
    @Query(
        value =
            "INSERT INTO session_edit_drafts(session_id,base_session_version,payload,actor_id,updated_at) VALUES(:id,:base,CAST(:payload AS jsonb),:actor,:now) ON CONFLICT(session_id) DO UPDATE SET version=nextval('session_draft_revision'),base_session_version=excluded.base_session_version,payload=excluded.payload,actor_id=excluded.actor_id,updated_at=excluded.updated_at",
        nativeQuery = true,
    )
    fun saveDraft(id: UUID, actor: UUID, base: Long, payload: String, now: OffsetDateTime): Int

    @Modifying
    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(value = "DELETE FROM session_edit_drafts WHERE session_id=:id", nativeQuery = true)
    fun deleteDraft(id: UUID): Int

    // Native SQL: сохранить обработку JSONB, сохранить соединение таблиц владельцев.
    @Query(
        value =
            "SELECT e.id,e.action,e.occurred_at AS \"occurredAt\",a.name AS author,CAST(e.before_state AS text) AS \"beforeState\",CAST(e.after_state AS text) AS \"afterState\" FROM audit_events e LEFT JOIN accounts a ON a.id=e.actor_id WHERE e.aggregate_id=:id ORDER BY e.occurred_at DESC,e.id DESC LIMIT :limit OFFSET :offset",
        nativeQuery = true,
    )
    fun history(id: UUID, limit: Int, offset: Long): List<SessionHistoryProjection>

    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(value = "SELECT count(*) FROM audit_events WHERE aggregate_id=:id", nativeQuery = true)
    fun countHistory(id: UUID): Long

    // Native SQL: сохранить обработку JSONB.
    @Query(
        value =
            "SELECT CAST(after_state AS text) FROM audit_events WHERE aggregate_id=:id AND id=:revision",
        nativeQuery = true,
    )
    fun revision(id: UUID, revision: Long): String?
}

@Repository
class SessionDraftRepository(
    private val queries: SessionDraftQueries,
    private val json: JsonMapper,
) {
    fun find(id: UUID): SessionDraftView? =
        queries.draft(id)?.let {
            SessionDraftView(
                it.version,
                it.baseVersion,
                json.readValue(it.payload, SessionInput::class.java),
                it.updatedAt,
                it.author,
            )
        }

    fun save(id: UUID, actor: UUID, base: Long, input: SessionInput, now: Instant) {
        queries.saveDraft(
            id,
            actor,
            base,
            json.writeValueAsString(input),
            now.atOffset(ZoneOffset.UTC),
        )
    }

    fun delete(id: UUID) {
        queries.deleteDraft(id)
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
            queries
                .history(
                    id,
                    Metadata.Editor.HISTORY_SIZE,
                    page.toLong() * Metadata.Editor.HISTORY_SIZE,
                )
                .map {
                    SessionRevision(
                        it.id,
                        it.action,
                        it.occurredAt,
                        it.author ?: "Оператор",
                        parameters(it.beforeState),
                        parameters(it.afterState),
                    )
                }
        return SessionHistory(items, queries.countHistory(id), page)
    }

    fun revision(id: UUID, revision: Long): SessionInput? =
        parameters(queries.revision(id, revision))
}
