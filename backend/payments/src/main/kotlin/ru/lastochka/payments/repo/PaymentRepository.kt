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
import ru.lastochka.payments.entity.AlfaTestAttemptEntity

interface AlfaTestAttemptQueries : JpaRepository<AlfaTestAttemptEntity, UUID> {
    fun findByOrderNumber(orderNumber: String): AlfaTestAttemptEntity?

    @Modifying
    @Query(value = "INSERT INTO alfa_test_callback_events(signature_hash,payment_id) VALUES(:signatureHash,:paymentId) ON CONFLICT(signature_hash) DO NOTHING", nativeQuery = true)
    fun acceptCallback(signatureHash: String, paymentId: UUID): Int

    @Modifying
    @Query(value = "UPDATE alfa_test_attempts SET next_check_at=:now,callback_pending=true,revision=revision+1 WHERE payment_id=:paymentId", nativeQuery = true)
    fun scheduleCallback(paymentId: UUID, now: Instant): Int

    @Modifying
    @Query(value = "INSERT INTO alfa_test_attempts(payment_id,config_version,order_number,draft_version,amount_minor,purpose,operation_state) VALUES(:paymentId,:configVersion,:orderNumber,:draftVersion,:amountMinor,:purpose,'REGISTERING') ON CONFLICT(payment_id) DO NOTHING", nativeQuery = true)
    fun create(paymentId: UUID, configVersion: UUID, orderNumber: String, draftVersion: Long, amountMinor: Long, purpose: String): Int

    @Modifying
    @Query(value = "UPDATE alfa_test_attempts SET order_id=COALESCE(order_id,:orderId),link_ciphertext=COALESCE(link_ciphertext,:link),operation_state=CASE WHEN operation_state='REGISTERING' THEN :state ELSE operation_state END,bank_error=CASE WHEN operation_state='REGISTERING' THEN :error ELSE bank_error END,revision=revision+1,updated_at=now() WHERE payment_id=:id AND (order_id IS NULL OR order_id=COALESCE(:orderId,order_id)) AND (operation_state='REGISTERING' OR (:state='OPEN' AND COALESCE(order_id,:orderId) IS NOT NULL))", nativeQuery = true)
    fun registrationResult(id: UUID, orderId: String?, link: ByteArray?, state: String, error: String?): Int

    @Modifying
    @Query(value = "UPDATE alfa_test_attempts SET bank_error='BANK_ORDER_MISMATCH',revision=revision+1,updated_at=now() WHERE payment_id=:id AND order_id IS NOT NULL AND order_id<>:orderId", nativeQuery = true)
    fun registrationConflict(id: UUID, orderId: String): Int

    @Modifying
    @Query(value = "UPDATE alfa_test_attempts SET operation_state='CANCEL_UNKNOWN',cancel_requested=true,revision=revision+1,updated_at=now(),next_check_at=now() WHERE payment_id=:id AND operation_state='OPEN' AND bank_status='REGISTERED' AND cancel_requested=false", nativeQuery = true)
    fun requestCancel(id: UUID): Int

    @Modifying
    @Query(value = "UPDATE alfa_test_attempts SET operation_state='CANCELLED',bank_status='CANCELLED',bank_checked_at=:checkedAt,bank_error=NULL,archived=true,revision=revision+1,updated_at=now() WHERE payment_id=:id AND operation_state='CANCEL_UNKNOWN' AND cancel_requested=true", nativeQuery = true)
    fun cancellationConfirmed(id: UUID, checkedAt: Instant): Int

    @Modifying
    @Query(value = "UPDATE alfa_test_attempts SET lease_until=:until,revision=revision+1 WHERE payment_id=:id AND (lease_until IS NULL OR lease_until<:now)", nativeQuery = true)
    fun claim(id: UUID, now: Instant, until: Instant): Int

    @Modifying
    @Query(value = "UPDATE alfa_test_attempts SET order_id=COALESCE(order_id,:orderId), operation_state=:state,bank_status=:status,bank_checked_at=:checkedAt,bank_error=NULL, archived=CASE WHEN :state='PAID' THEN true ELSE archived END, rejected_at=CASE WHEN :state='DECLINED' AND bank_status='DECLINED' THEN rejected_at WHEN :state='DECLINED' THEN :checkedAt ELSE NULL END, lease_until=NULL,callback_pending=false,next_check_at=:nextCheck,revision=revision+1,updated_at=now() WHERE payment_id=:id AND revision=:revision", nativeQuery = true)
    fun statusResult(id: UUID, revision: Long, orderId: String?, state: String, status: String, checkedAt: Instant, nextCheck: Instant): Int

    @Modifying
    @Query(value = "UPDATE alfa_test_attempts SET bank_error='BANK_UNAVAILABLE', lease_until=NULL,next_check_at=:nextCheck,revision=revision+1,updated_at=now() WHERE payment_id=:id AND revision=:revision", nativeQuery = true)
    fun statusError(id: UUID, revision: Long, nextCheck: Instant): Int

    @Modifying
    @Query(value = "UPDATE alfa_test_attempts SET archived=true,revision=revision+1,updated_at=now() WHERE payment_id=:id AND bank_status='DECLINED' AND operation_state='DECLINED' AND archived=false", nativeQuery = true)
    fun archiveRejected(id: UUID): Int

    @Modifying
    @Query(value = "UPDATE alfa_test_attempts SET archived=true,revision=revision+1,updated_at=now() WHERE archived=false AND bank_status='DECLINED' AND operation_state='DECLINED' AND rejected_at IS NOT NULL AND rejected_at<=:threshold", nativeQuery = true)
    fun archiveExpired(threshold: Instant): Int

    @Query(value = "SELECT payment_id FROM alfa_test_attempts WHERE ((archived=false AND operation_state NOT IN ('PAID','CANCELLED')) OR callback_pending=true) AND next_check_at<=:now AND (lease_until IS NULL OR lease_until<:now) ORDER BY next_check_at,payment_id LIMIT 10", nativeQuery = true)
    fun due(now: Instant): List<UUID>
}

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

    @Query(
        "select p.id as id,p.amountMinor as amountMinor,p.purpose as purpose,p.recipientName as recipientName,p.phone as phone,p.enquiryId as enquiryId,p.version as version,p.createdAt as createdAt from PaymentEntity p where not exists (select a.paymentId from AlfaTestAttemptEntity a where a.paymentId=p.id and a.archived=true) order by p.createdAt desc,p.id desc"
    )
    fun listActive(page: Pageable): List<PaymentProjection>

    @Query(
        "select p.id as id,p.amountMinor as amountMinor,p.purpose as purpose,p.recipientName as recipientName,p.phone as phone,p.enquiryId as enquiryId,p.version as version,p.createdAt as createdAt from PaymentEntity p where exists (select a.paymentId from AlfaTestAttemptEntity a where a.paymentId=p.id and a.archived=true) order by p.createdAt desc,p.id desc"
    )
    fun listArchived(page: Pageable): List<PaymentProjection>

    @Query("select count(a) from AlfaTestAttemptEntity a where a.archived=true")
    fun countArchived(): Long

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
class PaymentRepository(
    private val queries: PaymentQueries,
    private val attempts: AlfaTestAttemptQueries,
) {
    private fun map(p: PaymentProjection): PaymentView {
        val attempt = attempts.findById(p.id).orElse(null)
        return PaymentView(
            p.id,
            p.amountMinor,
            p.purpose,
            p.recipientName,
            p.phone,
            p.enquiryId,
            p.version,
            p.createdAt,
            operationState = attempt?.operationState,
            bankStatus = attempt?.bankStatus,
            bankCheckedAt = attempt?.bankCheckedAt,
            bankError = attempt?.bankError,
            snapshotAmountMinor = attempt?.amountMinor,
            snapshotPurpose = attempt?.purpose,
            archived = attempt?.archived ?: false,
            linkAvailable = attempt?.linkCiphertext != null,
        )
    }

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

    fun page(page: Int, category: String? = null): PaymentPage {
        val size = if (category == null) Metadata.Concept.PAGE_SIZE else Metadata.AlfaPayment.PAGE_SIZE
        val request = PageRequest.of(page, size)
        val archived = if (category == null) 0 else queries.countArchived()
        return when (category) {
            Metadata.AlfaPayment.CATEGORY_ACTIVE -> PaymentPage(queries.listActive(request).map(::map), queries.count() - archived)
            Metadata.AlfaPayment.CATEGORY_ARCHIVED -> PaymentPage(queries.listArchived(request).map(::map), archived)
            else -> PaymentPage(queries.list(request).map(::map), queries.count())
        }
    }
}
