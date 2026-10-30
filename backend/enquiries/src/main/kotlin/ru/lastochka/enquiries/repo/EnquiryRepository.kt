package ru.lastochka.enquiries.repo

import java.time.Clock
import java.util.UUID
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import ru.lastochka.common.Metadata
import ru.lastochka.enquiries.dto.*

@Repository
class EnquiryRepository(private val jdbc: JdbcClient, private val clock: Clock) {
    fun replay(key: UUID): Pair<String, UUID>? =
        jdbc
            .sql(
                "SELECT request_hash,enquiry_id FROM enquiry_replays WHERE key=:key AND expires_at>now()"
            )
            .param("key", key)
            .query { r, _ ->
                r.getString("request_hash") to r.getObject("enquiry_id", UUID::class.java)
            }
            .optional()
            .orElse(null)

    fun lock(key: UUID) {
        jdbc
            .sql("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))")
            .param("key", key.toString())
            .query { _, _ -> true }
            .single()
    }

    fun insert(id: UUID, input: EnquiryInput, snapshot: String?): EnquiryView {
        jdbc
            .sql(
                "INSERT INTO enrollment_requests(id,parent_name,phone,child_name,child_age,desired_session_id,desired_session_snapshot,comment,created_at) VALUES(:id,:parent,:phone,:child,:age,:session,:snapshot,:comment,:now)"
            )
            .params(
                mapOf(
                    "id" to id,
                    "parent" to input.parentName,
                    "phone" to input.phone,
                    "child" to input.childName,
                    "age" to input.childAge,
                    "session" to input.desiredSessionId,
                    "snapshot" to snapshot,
                    "comment" to input.comment,
                    "now" to clock.instant().atOffset(java.time.ZoneOffset.UTC),
                )
            )
            .update()
        return requireNotNull(find(id))
    }

    fun saveReplay(key: UUID, hash: String, id: UUID) {
        jdbc
            .sql(
                "INSERT INTO enquiry_replays(key,request_hash,enquiry_id,expires_at) VALUES(:key,:hash,:id,:expires) ON CONFLICT(key) DO UPDATE SET request_hash=excluded.request_hash,enquiry_id=excluded.enquiry_id,expires_at=excluded.expires_at"
            )
            .params(
                mapOf(
                    "key" to key,
                    "hash" to hash,
                    "id" to id,
                    "expires" to
                        clock
                            .instant()
                            .plusSeconds(Metadata.Concept.REPLAY_SECONDS)
                            .atOffset(java.time.ZoneOffset.UTC),
                )
            )
            .update()
    }

    private fun map(r: java.sql.ResultSet) =
        EnquiryView(
            r.getObject("id", UUID::class.java),
            r.getLong("public_number"),
            r.getString("parent_name"),
            r.getString("phone"),
            r.getString("child_name"),
            r.getObject("child_age", Int::class.javaObjectType),
            r.getString("desired_session_snapshot"),
            r.getString("comment"),
            r.getTimestamp("created_at").toInstant(),
        )

    fun find(id: UUID): EnquiryView? =
        jdbc
            .sql("SELECT * FROM enrollment_requests WHERE id=:id")
            .param("id", id)
            .query { r, _ -> map(r) }
            .optional()
            .orElse(null)

    fun page(page: Int): EnquiryPage =
        EnquiryPage(
            jdbc
                .sql(
                    "SELECT * FROM enrollment_requests ORDER BY created_at DESC,id DESC LIMIT :size OFFSET :offset"
                )
                .param("size", Metadata.Concept.PAGE_SIZE)
                .param("offset", page.toLong() * Metadata.Concept.PAGE_SIZE)
                .query { r, _ -> map(r) }
                .list(),
            jdbc.sql("SELECT count(*) FROM enrollment_requests").query(Long::class.java).single(),
        )
}
