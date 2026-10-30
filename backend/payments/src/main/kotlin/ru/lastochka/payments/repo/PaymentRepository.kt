package ru.lastochka.payments.repo

import java.time.Instant
import java.util.UUID
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository
import ru.lastochka.common.Metadata
import ru.lastochka.payments.dto.*
import ru.lastochka.payments.entity.PaymentEntity

interface PaymentProjection {
    val id: UUID
    val amountMinor: Long
    val purpose: String
    val recipientName: String
    val phone: String
    val enquiryId: UUID?
    val version: Long
    val createdAt: Instant
}

interface PaymentQueries : JpaRepository<PaymentEntity, UUID> {
    @Query(
        "select p.id as id,p.amountMinor as amountMinor,p.purpose as purpose,p.recipientName as recipientName,p.phone as phone,p.enquiryId as enquiryId,p.version as version,p.createdAt as createdAt from PaymentEntity p where p.id=:id"
    )
    fun view(id: UUID): PaymentProjection?

    @Query(
        "select p.id as id,p.amountMinor as amountMinor,p.purpose as purpose,p.recipientName as recipientName,p.phone as phone,p.enquiryId as enquiryId,p.version as version,p.createdAt as createdAt from PaymentEntity p order by p.createdAt desc,p.id desc"
    )
    fun list(page: Pageable): List<PaymentProjection>

    // INSERT сохраняет серверные значения created_at и version без изменения схемы.
    @Modifying
    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(
        value =
            "INSERT INTO payment_requests(id,amount_minor,purpose,recipient_name,phone,enquiry_id,created_by) VALUES(:id,:amount,:purpose,:name,:phone,:enquiry,:actor)",
        nativeQuery = true,
    )
    fun create(
        id: UUID,
        amount: Long,
        purpose: String,
        name: String,
        phone: String,
        enquiry: UUID?,
        actor: UUID,
    ): Int

    // now() сохраняет прежнее серверное время обновления и условие версии.
    @Modifying
    // Native SQL: сохранить исходные серверные значения и семантику операции.
    @Query(
        value =
            "UPDATE payment_requests SET amount_minor=:amount,purpose=:purpose,recipient_name=:name,phone=:phone,enquiry_id=:enquiry,version=version+1,updated_at=now() WHERE id=:id AND version=:version",
        nativeQuery = true,
    )
    fun update(
        id: UUID,
        amount: Long,
        purpose: String,
        name: String,
        phone: String,
        enquiry: UUID?,
        version: Long?,
    ): Int
}

@Repository
class PaymentRepository(private val queries: PaymentQueries) {
    private fun map(p: PaymentProjection) =
        PaymentView(
            p.id,
            p.amountMinor,
            p.purpose,
            p.recipientName,
            p.phone,
            p.enquiryId,
            p.version,
            p.createdAt,
        )

    fun find(id: UUID): PaymentView? = queries.view(id)?.let(::map)

    fun save(id: UUID, actor: UUID, v: PaymentInput, create: Boolean): Int =
        if (create)
            queries.create(
                id,
                v.amountMinor,
                v.purpose,
                v.recipientName,
                v.phone,
                v.enquiryId,
                actor,
            )
        else
            queries.update(
                id,
                v.amountMinor,
                v.purpose,
                v.recipientName,
                v.phone,
                v.enquiryId,
                v.expectedVersion,
            )

    fun page(page: Int) =
        PaymentPage(
            queries.list(PageRequest.of(page, Metadata.Concept.PAGE_SIZE)).map(::map),
            queries.count(),
        )
}
