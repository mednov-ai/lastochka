package ru.lastochka.payments.alfa

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.time.Clock
import java.util.UUID
import org.springframework.beans.factory.annotation.Value
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Service
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.support.TransactionTemplate
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

/** Production data is never read or written when the server policy forbids production. */
@Service
class AlfaProductionConfigurationService(
    private val policy: AlfaProductionPolicy,
    private val readiness: AlfaProductionReadiness,
    private val configuration: AlfaConfigurationRepository,
    private val versions: AlfaCredentialsRepository,
    private val links: AlfaLinkRotationRepository,
    private val box: AlfaProductionSecretBox,
    private val testBox: AlfaSecretBox,
    private val bank: AlfaProductionHttpGateway,
    private val attempts: AlfaTestAttemptQueries,
    private val commands: CommandService,
    private val login: LoginSessionService,
    private val clock: Clock,
    transactions: PlatformTransactionManager,
    @Value(Metadata.AlfaConnection.PRODUCTION_PROBE_CONFIRMED) private val probeConfirmed: Boolean,
    @Value(Metadata.AlfaConnection.PRODUCTION_FORM_HOSTS) private val formHosts: String = "",
) {
    private val tx = TransactionTemplate(transactions)
    private val unavailable = Metadata.Concept.PAYMENT_PROVIDER_NOT_CONFIGURED
    private fun requireAllowed() { if (!policy.productionAllowed()) conflict(unavailable) }
    private fun state() = configuration.findById(Metadata.AlfaConnection.PRODUCTION_CONFIGURATION_ID).orElseThrow()
    private fun requireKey(id: String?) {
        if (id == null || id != box.activeKeyId() || !box.available()) conflict(unavailable)
        if (testBox.available() && box.sharesActiveKeyWith(testBox)) conflict(unavailable)
    }
    private fun requireAdminAfterLock(actor: UUID) {
        val request = (RequestContextHolder.getRequestAttributes() as? ServletRequestAttributes)?.request ?: return
        val auth = SecurityContextHolder.getContext().authentication ?: unauthorized(Metadata.ErrorCodes.AUTH_REQUIRED)
        val account = login.requireStage(request, auth)
        if (account.id != actor || account.role != Metadata.Identity.ADMIN) forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
    }

    @Transactional(readOnly = true)
    fun view(): AlfaProductionConfigView {
        if (!policy.productionAllowed())
            return AlfaProductionConfigView(false, false, false, false, false, setOf(AlfaProductionObstacle.FORBIDDEN), null)
        val current = state()
        val obstacles = readiness.obstacles()
        val configured = current.activeVersion != null
        return AlfaProductionConfigView(true, configured, current.enabled, current.candidateVersion != null,
            configured && current.enabled && current.currentKeyId == box.activeKeyId() && obstacles.isEmpty(), obstacles, current.updatedAt)
    }

    @Transactional
    fun candidate(actor: UUID, input: AlfaProductionCandidateRequest): AlfaProductionConfigView {
        requireAllowed()
        if (!input.productionConfirmed || input.login.isBlank() || input.password.isBlank() ||
            input.login.length > Metadata.AlfaConnection.MAX_CREDENTIAL_LENGTH ||
            input.password.length > Metadata.AlfaConnection.MAX_CREDENTIAL_LENGTH ||
            input.login.any { it.isISOControl() } || input.password.any { it.isISOControl() })
            badRequest(Metadata.AlfaConnection.INVALID_CREDENTIALS)
        commands.lockStudio()
        requireAdminAfterLock(actor)
        val before = view()
        val current = state()
        if (current.currentKeyId == null) {
            if (!box.available() || versions.countByEnvironment(Metadata.AlfaConnection.PRODUCTION_ENVIRONMENT) != 0L) conflict(unavailable)
            current.currentKeyId = box.activeKeyId()
        }
        requireKey(current.currentKeyId)
        val plain = ByteArrayOutputStream().use { output ->
            DataOutputStream(output).use { data -> data.writeUTF(input.login.trim()); data.writeUTF(input.password); data.writeBoolean(false) }
            output.toByteArray()
        }
        val ciphertext = try { box.seal(plain, "credentials") }
        catch (_: Exception) { conflict(unavailable) }
        finally { plain.fill(0) }
        val version = UUID.randomUUID()
        versions.save(AlfaCredentialsEntity(version, ciphertext, clock.instant(), actor, Metadata.AlfaConnection.PRODUCTION_ENVIRONMENT))
        current.candidateVersion = version
        current.revision += 1
        current.updatedAt = clock.instant()
        current.updatedBy = actor
        configuration.save(current)
        val after = view()
        commands.audit(version, actor, Metadata.AlfaConnection.PRODUCTION_CANDIDATE_SAVED, before, after)
        return after
    }

    fun credentials(version: UUID): AlfaCredentials {
        requireAllowed()
        val row = versions.findById(version).orElseThrow { IllegalStateException("Production configuration unavailable") }
        check(row.environment == Metadata.AlfaConnection.PRODUCTION_ENVIRONMENT) { "Invalid production configuration environment" }
        val plain = try { box.open(row.ciphertext, "credentials") }
        catch (_: Exception) { throw IllegalStateException("Production configuration unavailable") }
        try {
            val input = DataInputStream(ByteArrayInputStream(plain))
            return AlfaCredentials(input.readUTF(), input.readUTF(), if (input.readBoolean()) input.readUTF() else null)
        } finally { plain.fill(0) }
    }

    fun checkCandidate(actor: UUID): AlfaProductionConfigView {
        requireAllowed()
        if (!probeConfirmed) return view()
        val plan = tx.execute {
            commands.lockStudio()
            requireAdminAfterLock(actor)
            val current = state()
            val version = current.candidateVersion ?: return@execute null
            requireKey(current.currentKeyId)
            val number = UUID.randomUUID().toString().replace("-", "")
            if (attempts.findByOrderNumber(number) != null) conflict(unavailable)
            Probe(version, current.revision, number, credentials(version))
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
            if (!policy.productionAllowed() || !probeConfirmed || current.candidateVersion != plan.version || current.revision != plan.revision)
                return@execute view()
            requireKey(current.currentKeyId)
            val before = view()
            current.activeVersion = plan.version
            current.candidateVersion = null
            current.enabled = true
            current.revision += 1
            current.updatedAt = clock.instant()
            current.updatedBy = actor
            configuration.save(current)
            val after = view()
            commands.audit(plan.version, actor, Metadata.AlfaConnection.PRODUCTION_CONFIG_ACTIVATED, before, after)
            after
        } ?: view()
    }

    @Transactional
    fun disable(actor: UUID): AlfaProductionConfigView {
        requireAllowed()
        commands.lockStudio()
        requireAdminAfterLock(actor)
        val before = view()
        val current = state()
        current.enabled = false
        current.revision += 1
        current.updatedAt = clock.instant()
        current.updatedBy = actor
        configuration.save(current)
        val after = view()
        commands.audit(current.activeVersion ?: current.candidateVersion ?: actor, actor, Metadata.AlfaConnection.PRODUCTION_CONFIG_DISABLED, before, after)
        return after
    }

    fun activeVersion(): UUID? {
        if (!policy.productionAllowed() || readiness.obstacles().isNotEmpty()) return null
        val current = state()
        return if (current.enabled && current.currentKeyId == box.activeKeyId()) current.activeVersion else null
    }

    @Transactional
    fun rotateKey(actor: UUID, target: String): AlfaProductionConfigView {
        requireAllowed()
        commands.lockStudio()
        requireAdminAfterLock(actor)
        val current = state()
        requireKey(current.currentKeyId)
        if (!box.available(target) || target == current.currentKeyId ||
            (testBox.available() && box.sharesKeyWith(target, testBox))) conflict(unavailable)
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
        versions.findAllByEnvironment(Metadata.AlfaConnection.PRODUCTION_ENVIRONMENT).forEach { row ->
            row.ciphertext = reencrypt(row.ciphertext, "credentials")
            versions.save(row)
        }
        links.withProductionLinks().forEach { row ->
            check(links.replaceLink(row.paymentId, reencrypt(requireNotNull(row.linkCiphertext), "link")) == 1)
        }
        current.currentKeyId = target
        current.revision += 1
        current.updatedAt = clock.instant()
        current.updatedBy = actor
        configuration.save(current)
        val after = view()
        commands.audit(current.activeVersion ?: current.candidateVersion ?: actor, actor, Metadata.AlfaConnection.PRODUCTION_KEY_ROTATED, before, after)
        return after
    }

    /** Existing production attempts can still be reconciled if new issuance prerequisites change. */
    fun availableForReconciliation(): Boolean {
        if (!policy.productionAllowed() || !box.available()) return false
        val current = state()
        return current.enabled && current.currentKeyId == box.activeKeyId() && current.activeVersion != null &&
            !(testBox.available() && box.sharesActiveKeyWith(testBox))
    }

    @Transactional(propagation = Propagation.MANDATORY)
    fun encryptLink(value: String): ByteArray {
        requireAllowed()
        requireKey(state().currentKeyId)
        return box.seal(value.toByteArray(Charsets.UTF_8), "link")
    }

    fun decryptLink(value: ByteArray): String {
        requireAllowed()
        return box.open(value, "link").toString(Charsets.UTF_8)
    }

    fun validFormUrl(value: String): Boolean = runCatching {
        requireAllowed()
        val uri = java.net.URI(value)
        val hosts = formHosts.split(',').map { it.trim().lowercase(java.util.Locale.ROOT) }.filter { it.isNotEmpty() }.toSet()
        value.length <= Metadata.AlfaConnection.MAX_FORM_URL_LENGTH && uri.scheme == "https" && uri.userInfo == null &&
            uri.fragment == null && uri.port in setOf(-1, Metadata.AlfaConnection.HTTPS_PORT) &&
            uri.host?.lowercase(java.util.Locale.ROOT) in hosts
    }.getOrDefault(false)

    private class Probe(val version: UUID, val revision: Long, val orderNumber: String, val credentials: AlfaCredentials)
}
