package ru.lastochka.payments.alfa

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.nio.file.Files
import java.nio.file.Path
import java.time.Clock
import java.time.Instant
import java.util.Base64
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.anyString
import org.mockito.ArgumentMatchers.isNull
import org.mockito.Mockito.*
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.web.context.request.RequestContextHolder
import org.springframework.web.context.request.ServletRequestAttributes
import org.springframework.web.server.ResponseStatusException
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.unauthorized
import ru.lastochka.common.service.CommandService
import ru.lastochka.identity.entity.Account
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.payments.entity.AlfaConfigurationEntity
import ru.lastochka.payments.entity.AlfaCredentialsEntity
import ru.lastochka.payments.repo.AlfaConfigurationRepository
import ru.lastochka.payments.repo.AlfaCredentialsRepository
import ru.lastochka.payments.repo.AlfaLinkRotationRepository
import ru.lastochka.payments.repo.AlfaTestAttemptQueries

class AlfaProductionCandidateProbeTest {
    @TempDir lateinit var directory: Path

    private fun exercise(responseCode: String, expireSession: Boolean = false, duringProbe: (AlfaConfigurationEntity) -> Unit = {}) {
        Files.writeString(directory.resolve("production.key"), Base64.getEncoder().encodeToString(ByteArray(32) { 3 }))
        val box = AlfaProductionSecretBox(directory.toString(), "production")
        val plain = ByteArrayOutputStream().use { out ->
            DataOutputStream(out).use { it.writeUTF("fixture-login"); it.writeUTF("fixture-password"); it.writeBoolean(false) }
            out.toByteArray()
        }
        val actor = UUID.randomUUID(); val candidate = UUID.randomUUID(); val active = UUID.randomUUID()
        val current = AlfaConfigurationEntity(id = 2, enabled = true, currentKeyId = "production", activeVersion = active,
            candidateVersion = candidate, environment = "PRODUCTION")
        val repository = mock(AlfaConfigurationRepository::class.java)
        `when`(repository.findById(2)).thenReturn(Optional.of(current))
        val versions = mock(AlfaCredentialsRepository::class.java)
        `when`(versions.findById(candidate)).thenReturn(Optional.of(AlfaCredentialsEntity(candidate, box.seal(plain, "credentials"), Instant.EPOCH, actor, "PRODUCTION")))
        plain.fill(0)
        val transactions = mock(PlatformTransactionManager::class.java)
        doAnswer { SimpleTransactionStatus() }.`when`(transactions).getTransaction(any())
        val policy = mock(AlfaProductionPolicy::class.java)
        `when`(policy.productionAllowed()).thenReturn(true)
        val testBox = mock(AlfaSecretBox::class.java)
        val bank = mock(AlfaProductionHttpGateway::class.java)
        doAnswer {
            duringProbe(current)
            AlfaStatusResult(null, null, null, null, null, responseCode)
        }.`when`(bank).status(any(AlfaCredentials::class.java) ?: AlfaCredentials("", ""), isNull(), anyString() ?: "")
        val login = mock(LoginSessionService::class.java)
        if (expireSession) {
            val request = MockHttpServletRequest()
            val auth = UsernamePasswordAuthenticationToken.authenticated("fixture", null, emptyList())
            RequestContextHolder.setRequestAttributes(ServletRequestAttributes(request))
            SecurityContextHolder.getContext().authentication = auth
            val account = Account(id = actor, email = "fixture@test.local", name = "Fixture", passwordHash = "x", role = Metadata.Identity.ADMIN)
            `when`(login.requireStage(request, auth)).thenReturn(account).thenAnswer { unauthorized(Metadata.ErrorCodes.REAUTH_REQUIRED) }
        }
        val readiness = mock(AlfaProductionReadiness::class.java)
        val service = AlfaProductionConfigurationService(policy, readiness, repository, versions, mock(AlfaLinkRotationRepository::class.java),
            box, testBox, bank, mock(AlfaTestAttemptQueries::class.java), mock(CommandService::class.java), login,
            Clock.systemUTC(), transactions, true)
        try {
            if (expireSession) assertThrows(ResponseStatusException::class.java) { service.checkCandidate(actor) }
            else service.checkCandidate(actor)
            assertEquals(active, current.activeVersion)
        } finally {
            RequestContextHolder.resetRequestAttributes()
            SecurityContextHolder.clearContext()
        }
    }

    @Test fun `ambiguous probe preserves current credentials`() = exercise("5")
    @Test fun `concurrent disable preserves current credentials`() = exercise("6") { it.enabled = false; it.revision += 1 }
    @Test fun `replacement candidate cannot be activated by an older probe`() = exercise("6") { it.candidateVersion = UUID.randomUUID(); it.revision += 1 }
    @Test fun `expired administrator session cannot activate a candidate`() = exercise("6", expireSession = true)
}
