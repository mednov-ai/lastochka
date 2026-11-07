package ru.lastochka.payments.alfa

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.time.Clock
import java.util.UUID
import org.springframework.beans.factory.annotation.Value
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.context.request.RequestContextHolder
import org.springframework.web.context.request.ServletRequestAttributes
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.badRequest
import ru.lastochka.common.error.conflict
import ru.lastochka.common.error.forbidden
import ru.lastochka.common.error.unauthorized
import ru.lastochka.common.service.CommandService
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.payments.entity.AlfaCredentialsEntity
import ru.lastochka.payments.repo.AlfaConfigurationRepository
import ru.lastochka.payments.repo.AlfaCredentialsRepository
import ru.lastochka.payments.repo.AlfaLinkRotationRepository
import ru.lastochka.payments.repo.AlfaTestAttemptQueries

@Service
class AlfaConfigurationService(
    private val config: AlfaConfigurationRepository,
    private val versions: AlfaCredentialsRepository,
    private val links: AlfaLinkRotationRepository,
    private val box: AlfaSecretBox,
    private val commands: CommandService,
    private val login: LoginSessionService,
    private val bank: AlfaBankGateway,
    private val attempts: AlfaTestAttemptQueries,
    private val clock: Clock,
    transactions: PlatformTransactionManager,
    @Value(Metadata.AlfaConnection.ENABLED) private val enabled: Boolean,
    @Value(Metadata.AlfaConnection.PROBE_CONFIRMED) private val probeConfirmed: Boolean,
    @Value(Metadata.AlfaConnection.FORM_HOSTS) private val formHosts: String,
) {
    private val tx = TransactionTemplate(transactions)
    private fun state() = config.findById(1).orElseThrow()

    @Transactional(readOnly = true)
    fun view(): AlfaConfigView {
        val value = state()
        return AlfaConfigView(enabled && value.enabled && value.currentKeyId == box.activeKeyId() && box.available(), value.activeVersion != null,
            value.candidateVersion != null, value.candidateVersion?.let { Metadata.AlfaConnection.UNVERIFIED },
            value.updatedAt, value.updatedBy)
    }

    @Transactional
    fun candidate(actor: UUID, input: AlfaCandidateRequest): AlfaConfigView {
        if (!input.testConfirmed || input.login.isBlank() || input.login.length > Metadata.AlfaConnection.MAX_CREDENTIAL_LENGTH ||
            input.password.isBlank() || input.password.length > Metadata.AlfaConnection.MAX_CREDENTIAL_LENGTH ||
            input.login.any { it.isISOControl() } || input.password.any { it.isISOControl() } ||
            (input.merchantLogin?.length ?: 0) > Metadata.AlfaConnection.MAX_CREDENTIAL_LENGTH ||
            input.merchantLogin?.any { it.isISOControl() } == true)
            badRequest(Metadata.AlfaConnection.INVALID_CREDENTIALS)
        commands.lockStudio()
        requireAdminAfterLock(actor)
        val before = view()
        val current = state()
        if (current.currentKeyId == null) {
            if (!box.available() || versions.count() != 0L || links.withLinks().isNotEmpty()) conflict(Metadata.Concept.PAYMENT_PROVIDER_NOT_CONFIGURED)
            current.currentKeyId = box.activeKeyId()
        }
        requireCurrentKey(current.currentKeyId)
        val plain = ByteArrayOutputStream().use { output ->
            DataOutputStream(output).use { data ->
                data.writeUTF(input.login.trim()); data.writeUTF(input.password)
                val merchant = input.merchantLogin?.trim()?.takeIf { it.isNotEmpty() }
                data.writeBoolean(merchant != null)
                if (merchant != null) data.writeUTF(merchant)
            }
            output.toByteArray()
        }
        val ciphertext = try { box.seal(plain, "credentials") }
        catch (_: Exception) { conflict(Metadata.Concept.PAYMENT_PROVIDER_NOT_CONFIGURED) }
        finally { plain.fill(0) }
        val version = UUID.randomUUID()
        versions.save(AlfaCredentialsEntity(version, ciphertext, clock.instant(), actor))
        current.candidateVersion = version
        current.revision += 1
        current.updatedAt = clock.instant()
        current.updatedBy = actor
        config.save(current)
        val after = view()
        commands.audit(version, actor, Metadata.AlfaConnection.CANDIDATE_SAVED, before, after)
        return after
    }

    @Transactional
    fun disable(actor: UUID): AlfaConfigView {
        commands.lockStudio()
        requireAdminAfterLock(actor)
        val before = view()
        val current = state()
        current.enabled = false
        current.revision += 1
        current.updatedAt = clock.instant()
        current.updatedBy = actor
        config.save(current)
        val after = view()
        commands.audit(current.activeVersion ?: current.candidateVersion ?: actor, actor, Metadata.AlfaConnection.CONFIG_DISABLED, before, after)
        return after
    }

    /** Bank confirmation is an operator prerequisite; no network call occurs before it. */
    fun checkCandidate(actor: UUID): AlfaConfigView {
        if (!enabled || !probeConfirmed) return view()
        val plan = tx.execute {
            commands.lockStudio()
            requireAdminAfterLock(actor)
            val current = state()
            val version = current.candidateVersion ?: return@execute null
            requireCurrentKey(current.currentKeyId)
            val number = UUID.randomUUID().toString().replace("-", "")
            if (attempts.findByOrderNumber(number) != null) conflict(Metadata.Concept.PAYMENT_PROVIDER_NOT_CONFIGURED)
            CandidateProbe(version, current.revision, number, credentials(version))
        } ?: return view()
        val result = try { bank.status(plan.credentials, null, plan.orderNumber) }
        catch (_: Exception) { return view() }
        val absent = result.errorCode == Metadata.AlfaConnection.ORDER_NOT_FOUND && result.orderId == null &&
            result.orderStatus == null && result.amountMinor == null && result.currency == null &&
            (result.orderNumber == null || result.orderNumber == plan.orderNumber)
        if (!absent) return view()
        return tx.execute {
            commands.lockStudio()
            requireAdminAfterLock(actor)
            val current = state()
            if (!enabled || !probeConfirmed || current.candidateVersion != plan.version || current.revision != plan.revision)
                return@execute view()
            requireCurrentKey(current.currentKeyId)
            val before = view()
            current.activeVersion = plan.version
            current.candidateVersion = null
            current.enabled = true
            current.revision += 1
            current.updatedAt = clock.instant()
            current.updatedBy = actor
            config.save(current)
            val after = view()
            commands.audit(plan.version, actor, Metadata.AlfaConnection.CONFIG_ACTIVATED, before, after)
            after
        } ?: view()
    }

    private class CandidateProbe(val version: UUID, val revision: Long, val orderNumber: String, val credentials: AlfaCredentials)

    /** Called under the caller's studio lock when accepting a new command. */
    fun activeVersion(): UUID? {
        if (!enabled || !box.available()) return null
        val value = state()
        return if (value.enabled && value.currentKeyId == box.activeKeyId()) value.activeVersion else null
    }

    fun credentials(version: UUID): AlfaCredentials {
        val row = versions.findById(version).orElseThrow { IllegalStateException("TEST configuration unavailable") }
        val plain = try { box.open(row.ciphertext, "credentials") }
        catch (_: Exception) { throw IllegalStateException("TEST configuration unavailable") }
        try {
            val input = DataInputStream(ByteArrayInputStream(plain))
            return AlfaCredentials(input.readUTF(), input.readUTF(), if (input.readBoolean()) input.readUTF() else null)
        } finally { plain.fill(0) }
    }

    @Transactional(propagation = Propagation.MANDATORY)
    fun encryptLink(value: String): ByteArray {
        // Callers take lockStudio before reading the key generation and writing the ciphertext.
        requireCurrentKey(state().currentKeyId)
        return box.seal(value.toByteArray(Charsets.UTF_8), "link")
    }
    fun decryptLink(value: ByteArray): String = box.open(value, "link").toString(Charsets.UTF_8)

    private fun requireCurrentKey(id: String?) {
        if (id == null || id != box.activeKeyId() || !box.available())
            conflict(Metadata.Concept.PAYMENT_PROVIDER_NOT_CONFIGURED)
    }

    private fun requireAdminAfterLock(actor: UUID) {
        // Non-web maintenance/tests have no servlet request. HTTP commands must recheck
        // freshness and identity after lockStudio's current-role/session guard.
        val request = (RequestContextHolder.getRequestAttributes() as? ServletRequestAttributes)?.request ?: return
        val auth = SecurityContextHolder.getContext().authentication ?: unauthorized(Metadata.ErrorCodes.AUTH_REQUIRED)
        val account = login.requireStage(request, auth)
        if (account.id != actor || account.role != Metadata.Identity.ADMIN) forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
    }

    /** Atomic DB rotation. Old app instances fail closed after commit until restarted with the new key ID. */
    @Transactional
    fun rotateKey(actor: UUID, target: String): AlfaConfigView {
        commands.lockStudio()
        requireAdminAfterLock(actor)
        val current = state()
        requireCurrentKey(current.currentKeyId)
        if (!box.available(target) || target == current.currentKeyId) conflict(Metadata.Concept.PAYMENT_PROVIDER_NOT_CONFIGURED)
        val before = view()
        fun reencrypt(ciphertext: ByteArray, purpose: String): ByteArray {
            val plain = box.open(ciphertext, purpose)
            try {
                val changed = box.sealWith(plain, purpose, target)
                val verified = box.open(changed, purpose)
                try { check(java.security.MessageDigest.isEqual(plain, verified)) }
                finally { verified.fill(0) }
                return changed
            } finally { plain.fill(0) }
        }
        versions.findAll().forEach { row -> row.ciphertext = reencrypt(row.ciphertext, "credentials"); versions.save(row) }
        links.withLinks().forEach { row ->
            check(links.replaceLink(row.paymentId, reencrypt(requireNotNull(row.linkCiphertext), "link")) == 1)
        }
        current.currentKeyId = target
        current.revision += 1
        current.updatedAt = clock.instant()
        current.updatedBy = actor
        config.save(current)
        val after = view()
        commands.audit(current.activeVersion ?: current.candidateVersion ?: actor, actor, Metadata.AlfaConnection.ROTATED, before, after)
        return after
    }

    fun validFormUrl(value: String): Boolean = runCatching {
        val uri = java.net.URI(value)
        val allowed = formHosts.split(',').map { it.trim().lowercase(java.util.Locale.ROOT) }
            .filter { it.isNotEmpty() }.toSet()
        value.length <= Metadata.AlfaConnection.MAX_FORM_URL_LENGTH && uri.scheme == "https" && uri.userInfo == null && uri.fragment == null &&
            uri.port in setOf(-1, Metadata.AlfaConnection.HTTPS_PORT) && uri.host?.lowercase(java.util.Locale.ROOT) in allowed
    }.getOrDefault(false)
}
