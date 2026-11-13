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
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.mock.web.MockHttpServletRequest
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.context.request.RequestContextHolder
import org.springframework.web.context.request.ServletRequestAttributes
import org.springframework.web.server.ResponseStatusException
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.unauthorized
import ru.lastochka.identity.entity.Account
import ru.lastochka.common.service.CommandService
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.payments.entity.AlfaConfigurationEntity
import ru.lastochka.payments.entity.AlfaCredentialsEntity
import ru.lastochka.payments.repo.AlfaConfigurationRepository
import ru.lastochka.payments.repo.AlfaCredentialsRepository
import ru.lastochka.payments.repo.AlfaLinkRotationRepository
import ru.lastochka.payments.repo.AlfaTestAttemptQueries

class AlfaCandidateProbeTest {
    @TempDir lateinit var directory: Path

    private class FakeBank : AlfaBankGateway {
        override var environment = AlfaGatewayEnvironment.TEST
        var calls = 0
        var action: () -> Unit = {}
        var response: AlfaStatusResult = AlfaStatusResult(null, null, null, null, null, "6")
        var fail = false
        override fun register(credentials: AlfaCredentials, orderNumber: String, amountMinor: Long, returnUrl: String): AlfaRegisterResult = error("not used")
        override fun status(credentials: AlfaCredentials, orderId: String?, orderNumber: String?): AlfaStatusResult {
            calls++; assertNull(orderId); assertEquals(32, orderNumber?.length); action()
            if (fail) error("temporary network failure")
            return response
        }
        override fun decline(credentials: AlfaCredentials, orderId: String?, orderNumber: String?): AlfaDeclineResult = error("not used")
    }

    private fun exercise(confirmed: Boolean, enabled: Boolean = true, stageExpires: Boolean = false, knownProbe: String = "", bankAction: FakeBank.(AlfaConfigurationEntity) -> Unit = {}): Pair<AlfaConfigurationEntity, FakeBank> {
        Files.writeString(directory.resolve("old.key"), Base64.getEncoder().encodeToString(ByteArray(32) { it.toByte() }))
        val box = AlfaSecretBox(directory.toString(), "old")
        val plaintext = ByteArrayOutputStream().use { out ->
            DataOutputStream(out).use { it.writeUTF("fixture-login"); it.writeUTF("fixture-password"); it.writeBoolean(false) }
            out.toByteArray()
        }
        val actor = UUID.randomUUID(); val candidate = UUID.randomUUID(); val active = UUID.randomUUID()
        val current = AlfaConfigurationEntity(enabled = true, currentKeyId = "old", activeVersion = active, candidateVersion = candidate)
        val repository = mock(AlfaConfigurationRepository::class.java)
        val versions = mock(AlfaCredentialsRepository::class.java)
        `when`(repository.findById(1)).thenReturn(Optional.of(current))
        `when`(versions.findById(candidate)).thenReturn(Optional.of(AlfaCredentialsEntity(candidate, box.seal(plaintext, "credentials"), Instant.now(), actor)))
        val transactions = mock(PlatformTransactionManager::class.java)
        doAnswer { SimpleTransactionStatus() }.`when`(transactions).getTransaction(any())
        val bank = FakeBank().apply { bankAction(current) }
        val login = mock(LoginSessionService::class.java)
        if (stageExpires) {
            val request = MockHttpServletRequest()
            val auth = UsernamePasswordAuthenticationToken.authenticated("fixture", null, emptyList())
            RequestContextHolder.setRequestAttributes(ServletRequestAttributes(request))
            SecurityContextHolder.getContext().authentication = auth
            val account = Account(id = actor, email = "fixture@test.local", name = "Fixture", passwordHash = "x", role = Metadata.Identity.ADMIN)
            `when`(login.requireStage(request, auth)).thenReturn(account).thenAnswer { unauthorized(Metadata.ErrorCodes.REAUTH_REQUIRED) }
        }
        val service = AlfaConfigurationService(repository, versions, mock(AlfaLinkRotationRepository::class.java), box,
            mock(CommandService::class.java), login, bank, mock(AlfaTestAttemptQueries::class.java),
            Clock.systemUTC(), transactions, enabled, confirmed, "", knownProbe)
        try {
            if (stageExpires) assertThrows(ResponseStatusException::class.java) { service.checkCandidate(actor) }
            else service.checkCandidate(actor)
        } finally { RequestContextHolder.resetRequestAttributes(); SecurityContextHolder.clearContext() }
        return current to bank
    }

    @Test fun `actual http gateway reports its test endpoint`() {
        val gateway = AlfaBankHttpGateway(tools.jackson.databind.json.JsonMapper.builder().build(), "")
        assertEquals(AlfaGatewayEnvironment.TEST, gateway.environment)
    }

    @Test fun `unknown or production gateway cannot activate test credentials`() {
        for (mode in listOf(AlfaGatewayEnvironment.UNKNOWN, AlfaGatewayEnvironment.PRODUCTION)) {
            val (state, bank) = exercise(true) { environment = mode }
            assertEquals(0, bank.calls)
            assertNotNull(state.candidateVersion)
        }
    }

    @Test fun `unknown and production modes reject storing and using test credentials`() {
        for (mode in listOf(AlfaGatewayEnvironment.UNKNOWN, AlfaGatewayEnvironment.PRODUCTION)) {
            val bank = FakeBank().apply { environment = mode }
            val repository = mock(AlfaConfigurationRepository::class.java)
            val versions = mock(AlfaCredentialsRepository::class.java)
            val service = AlfaConfigurationService(repository, versions, mock(AlfaLinkRotationRepository::class.java),
                AlfaSecretBox(directory.toString(), "missing"), mock(CommandService::class.java),
                mock(LoginSessionService::class.java), bank, mock(AlfaTestAttemptQueries::class.java),
                Clock.systemUTC(), mock(PlatformTransactionManager::class.java), true, true, "")
            assertThrows(ResponseStatusException::class.java) {
                service.candidate(UUID.randomUUID(), AlfaCandidateRequest("login", "password", true))
            }
            assertNull(service.activeVersion())
            verifyNoInteractions(repository, versions)
            assertEquals(0, bank.calls)
        }
    }

    @Test fun `no external probe before operator confirmation`() {
        val (state, bank) = exercise(false)
        assertEquals(0, bank.calls); assertNotNull(state.candidateVersion)
    }

    @Test fun `no external probe when test integration is disabled`() {
        val (state, bank) = exercise(true, enabled = false)
        assertEquals(0, bank.calls); assertNotNull(state.candidateVersion)
    }

    @Test fun `new candidate without merchant preserves old version and old clients remain compatible`() {
        Files.writeString(directory.resolve("old.key"), Base64.getEncoder().encodeToString(ByteArray(32) { it.toByte() }))
        val box = AlfaSecretBox(directory.toString(), "old")
        val actor = UUID.randomUUID()
        val active = UUID.randomUUID()
        val oldPlain = ByteArrayOutputStream().use { out ->
            DataOutputStream(out).use { it.writeUTF("old-login"); it.writeUTF("old-password"); it.writeBoolean(true); it.writeUTF("old-merchant") }
            out.toByteArray()
        }
        val stored = mutableMapOf(active to AlfaCredentialsEntity(active, box.seal(oldPlain, "credentials"), Instant.now(), actor))
        val current = AlfaConfigurationEntity(enabled = true, currentKeyId = "old", activeVersion = active)
        val repository = mock(AlfaConfigurationRepository::class.java)
        val versions = mock(AlfaCredentialsRepository::class.java)
        `when`(repository.findById(1)).thenReturn(Optional.of(current))
        `when`(versions.findById(any())).thenAnswer { Optional.ofNullable(stored[it.getArgument(0)]) }
        `when`(versions.save(any<AlfaCredentialsEntity>())).thenAnswer {
            val row = it.getArgument<AlfaCredentialsEntity>(0)
            stored[row.id] = row
            row
        }
        val bank = FakeBank()
        val service = AlfaConfigurationService(repository, versions, mock(AlfaLinkRotationRepository::class.java), box,
            mock(CommandService::class.java), mock(LoginSessionService::class.java), bank,
            mock(AlfaTestAttemptQueries::class.java), Clock.systemUTC(), mock(PlatformTransactionManager::class.java), true, false, "")

        service.candidate(actor, AlfaCandidateRequest("new-login", "new-password", true))
        val newVersion = requireNotNull(current.candidateVersion)
        assertEquals(active, current.activeVersion)
        assertEquals("old-merchant", service.credentials(active).merchantLogin)
        assertNull(service.credentials(newVersion).merchantLogin)
        service.checkCandidate(actor)
        assertEquals(0, bank.calls)
        assertEquals(active, current.activeVersion)

        service.candidate(actor, AlfaCandidateRequest("legacy-login", "legacy-password", true, "legacy-merchant"))
        assertEquals("legacy-merchant", service.credentials(requireNotNull(current.candidateVersion)).merchantLogin)
        assertNull(service.credentials(newVersion).merchantLogin)
        assertEquals("old-merchant", service.credentials(active).merchantLogin)
    }

    @Test fun `only nonmutating confirmed not found activates matching candidate`() {
        val (state, bank) = exercise(true)
        assertEquals(1, bank.calls); assertNull(state.candidateVersion); assertTrue(state.enabled)
    }

    @Test fun `known paid test order proves access without trusting an absent order response`() {
        val number = "knownorder1234567890123456789012"
        val path = directory.resolve("known-order.properties")
        Files.writeString(path, "orderNumber=$number\namountMinor=100\ncurrency=810\n")
        val (state, bank) = exercise(false, knownProbe = path.toString()) {
            response = AlfaStatusResult(number, null, 100, "810", Metadata.AlfaPayment.BANK_PAID, "0")
        }
        assertEquals(1, bank.calls); assertNull(state.candidateVersion); assertTrue(state.enabled)
    }

    @Test fun `known order requires matching number amount currency paid status and success`() {
        val number = "knownorder1234567890123456789012"
        val path = directory.resolve("known-order.properties")
        Files.writeString(path, "orderNumber=$number\namountMinor=100\ncurrency=810\n")
        val invalid = listOf(
            AlfaStatusResult(null, null, null, null, null, "6"),
            AlfaStatusResult("different1234567890123456789012", null, 100, "810", 2, "0"),
            AlfaStatusResult(number, null, 101, "810", 2, "0"),
            AlfaStatusResult(number, null, 100, "643", 2, "0"),
            AlfaStatusResult(number, null, 100, "810", 0, "0"),
            AlfaStatusResult(number, null, 100, "810", 2, "5"),
        )
        for (answer in invalid) {
            val (state, bank) = exercise(false, knownProbe = path.toString()) { response = answer }
            assertEquals(1, bank.calls); assertNotNull(state.candidateVersion)
        }
    }

    @Test fun `invalid known order file fails closed without calling bank`() {
        val path = directory.resolve("bad-order.properties")
        Files.writeString(path, "orderNumber=invalid\namountMinor=100\ncurrency=810\n")
        val (state, bank) = exercise(true, knownProbe = path.toString())
        assertEquals(0, bank.calls); assertNotNull(state.candidateVersion)
    }

    @Test fun `bank failure preserves candidate and previous active configuration`() {
        val (state, bank) = exercise(true) { fail = true }
        assertEquals(1, bank.calls); assertNotNull(state.candidateVersion); assertTrue(state.enabled)
    }

    @Test fun `found order cannot activate even if code says not found`() {
        val (state, _) = exercise(true) { response = AlfaStatusResult(null, "found", null, null, null, "6") }
        assertNotNull(state.candidateVersion)
    }

    @Test fun `disable while probe is in flight wins over late answer`() {
        val (state, _) = exercise(true) { current -> action = { current.enabled = false; current.revision++ } }
        assertFalse(state.enabled); assertNotNull(state.candidateVersion)
    }

    @Test fun `replacement while probe is in flight cannot activate old candidate`() {
        val newCandidate = UUID.randomUUID()
        val (state, _) = exercise(true) { current -> action = { current.candidateVersion = newCandidate; current.revision++ } }
        assertEquals(newCandidate, state.candidateVersion); assertNotEquals(newCandidate, state.activeVersion)
    }

    @Test fun `password confirmation expiring during probe prevents activation`() {
        val (state, bank) = exercise(true, stageExpires = true)
        assertEquals(1, bank.calls); assertNotNull(state.candidateVersion)
    }
}
