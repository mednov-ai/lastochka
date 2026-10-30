package ru.lastochka.payments.repo

import java.util.UUID
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository
import ru.lastochka.common.Metadata
import ru.lastochka.payments.dto.*

@Repository
class PaymentRepository(private val jdbc: JdbcClient) {
    private fun map(r: java.sql.ResultSet) =
        PaymentView(
            r.getObject("id", UUID::class.java),
            r.getLong("amount_minor"),
            r.getString("purpose"),
            r.getString("recipient_name"),
            r.getString("phone"),
            r.getObject("enquiry_id", UUID::class.java),
            r.getLong("version"),
            r.getTimestamp("created_at").toInstant(),
        )

    fun find(id: UUID): PaymentView? =
        jdbc
            .sql("SELECT * FROM payment_requests WHERE id=:id")
            .param("id", id)
            .query { r, _ -> map(r) }
            .optional()
            .orElse(null)

    fun save(id: UUID, actor: UUID, v: PaymentInput, create: Boolean): Int {
        val sql =
            if (create)
                "INSERT INTO payment_requests(id,amount_minor,purpose,recipient_name,phone,enquiry_id,created_by) VALUES(:id,:amount,:purpose,:name,:phone,:enquiry,:actor)"
            else
                "UPDATE payment_requests SET amount_minor=:amount,purpose=:purpose,recipient_name=:name,phone=:phone,enquiry_id=:enquiry,version=version+1,updated_at=now() WHERE id=:id AND version=:version"
        return jdbc
            .sql(sql)
            .params(
                mapOf(
                    "id" to id,
                    "amount" to v.amountMinor,
                    "purpose" to v.purpose,
                    "name" to v.recipientName,
                    "phone" to v.phone,
                    "enquiry" to v.enquiryId,
                    "actor" to actor,
                    "version" to v.expectedVersion,
                )
            )
            .update()
    }

    fun page(page: Int) =
        PaymentPage(
            jdbc
                .sql(
                    "SELECT * FROM payment_requests ORDER BY created_at DESC,id DESC LIMIT :size OFFSET :offset"
                )
                .param("size", Metadata.Concept.PAGE_SIZE)
                .param("offset", page.toLong() * Metadata.Concept.PAGE_SIZE)
                .query { r, _ -> map(r) }
                .list(),
            jdbc.sql("SELECT count(*) FROM payment_requests").query(Long::class.java).single(),
        )
}
