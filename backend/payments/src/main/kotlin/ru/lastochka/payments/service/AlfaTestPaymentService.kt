package ru.lastochka.payments.service

import java.time.Clock
import java.time.Duration
import java.util.UUID
import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.conflict
import ru.lastochka.common.error.notFound
import ru.lastochka.common.service.CommandService
import ru.lastochka.identity.service.StaffAccessService
import ru.lastochka.payments.alfa.AlfaBankGateway
import ru.lastochka.payments.alfa.AlfaConfigurationService
import ru.lastochka.payments.dto.PaymentLink
import ru.lastochka.payments.entity.AlfaTestAttemptEntity
import ru.lastochka.payments.repo.AlfaTestAttemptQueries
import ru.lastochka.payments.repo.PaymentRepository
import ru.lastochka.payments.utils.AlfaReturnUrl

/** TEST commands are accepted under the studio lock; bank I/O never holds it. */
@Service
class AlfaTestPaymentService(
    private val attempts: AlfaTestAttemptQueries,
    private val payments: PaymentRepository,
    private val config: AlfaConfigurationService,
    private val bank: AlfaBankGateway,
    private val commands: CommandService,
    private val access: StaffAccessService,
    private val clock: Clock,
    transactions: PlatformTransactionManager,
    @Value(Metadata.AlfaPayment.RETURN_URL_SETTING) private val returnUrl: String,
    @Value(Metadata.Configuration.LASTOCHKA_ORIGIN) private val publicOrigin: String,
    @Value(Metadata.AlfaPayment.DECLINE_SETTING) private val declineConfirmed: Boolean,
) {
    private val tx = TransactionTemplate(transactions)
    private val unavailable = Metadata.Concept.PAYMENT_PROVIDER_NOT_CONFIGURED

    private fun find(id: UUID) = payments.find(id) ?: notFound(Metadata.ErrorCodes.NOT_FOUND)
    private fun attempt(id: UUID) = attempts.findById(id).orElse(null)
    private fun verifiedReturnUrl(): Boolean = AlfaReturnUrl.allowed(returnUrl, publicOrigin)

    fun decorate(value: ru.lastochka.payments.dto.PaymentView): ru.lastochka.payments.dto.PaymentView {
        val ready = runCatching { config.activeVersion() != null }.getOrDefault(false)
        return value.copy(
            paymentLinkIssuanceAvailable = ready && verifiedReturnUrl() && value.operationState == null,
            canRefresh = ready && value.operationState != null && value.operationState !in setOf(Metadata.AlfaPayment.STATE_PAID, Metadata.AlfaPayment.STATE_CANCELLED),
            canCancel = ready && declineConfirmed && value.operationState == Metadata.AlfaPayment.STATE_OPEN && value.bankStatus == Metadata.AlfaPayment.STATUS_REGISTERED,
            canArchive = !value.archived && value.operationState == Metadata.AlfaPayment.STATE_DECLINED && value.bankStatus == Metadata.AlfaPayment.STATE_DECLINED,
        )
    }

    fun issue(actor: UUID, id: UUID, expectedVersion: Long): ru.lastochka.payments.dto.PaymentView {
        val created = tx.execute {
            commands.lockStudio()
            access.requirePaymentEdit(actor)
            val draft = find(id)
            if (draft.version != expectedVersion) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            val existing = attempt(id)
            if (existing != null) return@execute false
            val version = config.activeVersion() ?: conflict(unavailable)
            if (!verifiedReturnUrl()) conflict(unavailable)
            attempts.create(id, version, UUID.randomUUID().toString(), draft.version, draft.amountMinor, draft.purpose) == 1
        } ?: false
        if (created) {
            val current = tx.execute { attempt(id) } ?: conflict(unavailable)
            try {
                val response = bank.register(config.credentials(current.configVersion), current.orderNumber, current.amountMinor, returnUrl)
                // Successful register.do responses may omit errorCode; an explicit error remains ambiguous.
                val state = if ((response.errorCode == null || response.errorCode == "0") && !response.orderId.isNullOrBlank()) Metadata.AlfaPayment.STATE_OPEN else Metadata.AlfaPayment.STATE_UNKNOWN
                val safeOrderId = response.orderId?.takeIf { state == Metadata.AlfaPayment.STATE_OPEN }
                tx.execute {
                    commands.lockStudio()
                    val safeLink = if (state == Metadata.AlfaPayment.STATE_OPEN)
                        response.formUrl?.takeIf(config::validFormUrl)?.let(config::encryptLink) else null
                    val changed = attempts.registrationResult(id, safeOrderId, safeLink, state, if (state == Metadata.AlfaPayment.STATE_UNKNOWN) Metadata.AlfaPayment.BANK_UNCONFIRMED else null)
                    if (changed == 0 && safeOrderId != null) attempts.registrationConflict(id, safeOrderId)
                }
            } catch (_: Exception) {
                tx.execute { attempts.registrationResult(id, null, null, Metadata.AlfaPayment.STATE_UNKNOWN, Metadata.AlfaPayment.BANK_UNAVAILABLE) }
            }
        }
        return decorate(find(id))
    }

    fun refresh(actor: UUID, id: UUID, expectedVersion: Long): ru.lastochka.payments.dto.PaymentView {
        tx.execute {
            commands.lockStudio()
            access.requirePaymentEdit(actor)
            if (find(id).version != expectedVersion) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            if (config.activeVersion() == null || attempt(id) == null) conflict(unavailable)
        }
        reconcile(id)
        return decorate(find(id))
    }

    fun cancel(actor: UUID, id: UUID, expectedVersion: Long): ru.lastochka.payments.dto.PaymentView {
        val accepted = tx.execute {
            commands.lockStudio()
            access.requirePaymentEdit(actor)
            if (find(id).version != expectedVersion) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            val a = attempt(id) ?: conflict(unavailable)
            if (config.activeVersion() == null || !declineConfirmed) conflict(unavailable)
            if (a.cancelRequested) return@execute false
            if (config.credentials(a.configVersion).merchantLogin.isNullOrBlank()) conflict(unavailable)
            if (attempts.requestCancel(id) != 1) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            true
        } ?: false
        if (accepted) {
            val a = tx.execute { attempt(id) } ?: conflict(unavailable)
            val confirmed = try { bank.decline(config.credentials(a.configVersion), a.orderId, a.orderNumber).errorCode == "0" }
            catch (_: Exception) { false }
            if (confirmed) tx.execute { attempts.cancellationConfirmed(id, clock.instant()) }
            else reconcile(id)
        }
        return decorate(find(id))
    }

    fun archive(actor: UUID, id: UUID, expectedVersion: Long): ru.lastochka.payments.dto.PaymentView {
        tx.execute {
            commands.lockStudio()
            access.requirePaymentEdit(actor)
            if (find(id).version != expectedVersion) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
            if (attempts.archiveRejected(id) != 1) conflict(Metadata.ErrorCodes.VERSION_CONFLICT)
        }
        return decorate(find(id))
    }

    fun link(actor: UUID, id: UUID): PaymentLink = tx.execute {
        commands.lockStudio()
        access.requirePaymentEdit(actor)
        val ciphertext = attempt(id)?.linkCiphertext ?: conflict(unavailable)
        val url = try { config.decryptLink(ciphertext) } catch (_: Exception) { conflict(unavailable) }
        if (!config.validFormUrl(url)) conflict(unavailable)
        PaymentLink(url)
    } ?: conflict(unavailable)

    private fun reconcile(id: UUID) {
        val now = clock.instant()
        val claimed = tx.execute {
            commands.lockStudio()
            if (config.activeVersion() == null) return@execute null
            if (attempts.claim(id, now, now.plus(Duration.ofMinutes(Metadata.AlfaPayment.LEASE_MINUTES))) != 1) return@execute null
            // Native updates bypass the persistence context: reload in the next transaction.
            true
        } ?: return
        if (!claimed) return
        val row = tx.execute { attempt(id) } ?: return
        try {
            val response = bank.status(config.credentials(row.configVersion), row.orderId, row.orderNumber)
            val identityMatches = (response.orderNumber == row.orderNumber ||
                (row.orderId != null && response.orderId == row.orderId)) &&
                (response.orderNumber == null || response.orderNumber == row.orderNumber) &&
                (row.orderId == null || response.orderId == null || response.orderId == row.orderId)
            if (response.errorCode != "0" || !identityMatches || response.amountMinor != row.amountMinor ||
                response.currency !in setOf(Metadata.Concept.RUB, Metadata.AlfaPayment.ISO_RUB, Metadata.AlfaPayment.BANK_RUB)) throw IllegalStateException("unconfirmed")
            // An undocumented or stale status must not undo a confirmed terminal result.
            if (row.operationState in setOf(Metadata.AlfaPayment.STATE_PAID, Metadata.AlfaPayment.STATE_CANCELLED) &&
                response.orderStatus != Metadata.AlfaPayment.BANK_PAID) throw IllegalStateException("unconfirmed")
            val (state, status) = mapStatus(row, response.orderStatus)
            val checked = clock.instant()
            tx.execute { attempts.statusResult(id, row.revision, response.orderId, state, status, checked, checked.plus(Duration.ofMinutes(Metadata.AlfaPayment.RETRY_MINUTES))) }
        } catch (_: Exception) {
            tx.execute { attempts.statusError(id, row.revision, clock.instant().plus(Duration.ofMinutes(Metadata.AlfaPayment.RETRY_MINUTES))) }
        }
    }

    private fun mapStatus(row: AlfaTestAttemptEntity, status: Int?): Pair<String, String> = when (status) {
        0 -> (if (row.cancelRequested) Metadata.AlfaPayment.STATE_CANCEL_UNKNOWN else Metadata.AlfaPayment.STATE_OPEN) to Metadata.AlfaPayment.STATUS_REGISTERED
        Metadata.AlfaPayment.BANK_AUTHORIZING, Metadata.AlfaPayment.BANK_ACS -> (if (row.cancelRequested) Metadata.AlfaPayment.STATE_CANCEL_UNKNOWN else Metadata.AlfaPayment.STATE_OPEN) to Metadata.AlfaPayment.STATUS_AUTHORIZING
        Metadata.AlfaPayment.BANK_PAID -> Metadata.AlfaPayment.STATE_PAID to Metadata.AlfaPayment.STATE_PAID
        Metadata.AlfaPayment.BANK_DECLINED -> Metadata.AlfaPayment.STATE_DECLINED to Metadata.AlfaPayment.STATE_DECLINED
        else -> (if (row.cancelRequested) Metadata.AlfaPayment.STATE_CANCEL_UNKNOWN else Metadata.AlfaPayment.STATE_UNKNOWN) to Metadata.AlfaPayment.STATE_UNKNOWN
    }

    @Scheduled(fixedDelay = Metadata.AlfaPayment.POLL_MILLIS)
    fun poll() {
        val now = clock.instant()
        tx.execute { attempts.archiveExpired(now.minus(Duration.ofDays(Metadata.AlfaPayment.ARCHIVE_DAYS))) }
        if (!runCatching { config.activeVersion() != null }.getOrDefault(false)) return
        val due = tx.execute { attempts.due(now) } ?: emptyList()
        due.forEach(::reconcile)
    }
}
