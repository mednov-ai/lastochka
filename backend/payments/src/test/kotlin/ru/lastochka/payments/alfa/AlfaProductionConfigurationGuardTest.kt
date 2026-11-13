package ru.lastochka.payments.alfa

import java.time.Clock
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.web.server.ResponseStatusException
import ru.lastochka.common.service.CommandService
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.payments.repo.AlfaConfigurationRepository
import ru.lastochka.payments.repo.AlfaCredentialsRepository
import ru.lastochka.payments.repo.AlfaLinkRotationRepository
import ru.lastochka.payments.repo.AlfaTestAttemptQueries

class AlfaProductionConfigurationGuardTest {
    @Test fun `disabled policy blocks production data and all commands before database keys and network`() {
        val policy = mock(AlfaProductionPolicy::class.java)
        val readiness = mock(AlfaProductionReadiness::class.java)
        val configurations = mock(AlfaConfigurationRepository::class.java)
        val versions = mock(AlfaCredentialsRepository::class.java)
        val links = mock(AlfaLinkRotationRepository::class.java)
        val box = mock(AlfaProductionSecretBox::class.java)
        val testBox = mock(AlfaSecretBox::class.java)
        val bank = mock(AlfaProductionHttpGateway::class.java)
        val attempts = mock(AlfaTestAttemptQueries::class.java)
        val commands = mock(CommandService::class.java)
        val service = AlfaProductionConfigurationService(policy, readiness, configurations, versions, links, box,
            testBox, bank, attempts, commands, mock(LoginSessionService::class.java), Clock.systemUTC(),
            mock(PlatformTransactionManager::class.java), true)
        val actor = UUID.randomUUID()
        assertFalse(service.view().allowed)
        assertNull(service.activeVersion())
        assertThrows(ResponseStatusException::class.java) { service.candidate(actor, AlfaProductionCandidateRequest("fixture", "fixture", true)) }
        assertThrows(ResponseStatusException::class.java) { service.checkCandidate(actor) }
        assertThrows(ResponseStatusException::class.java) { service.disable(actor) }
        assertThrows(ResponseStatusException::class.java) { service.credentials(UUID.randomUUID()) }
        assertThrows(ResponseStatusException::class.java) { service.rotateKey(actor, "fixture") }
        assertThrows(ResponseStatusException::class.java) { service.encryptLink("https://fixture.test") }
        assertThrows(ResponseStatusException::class.java) { service.decryptLink(byteArrayOf(1)) }
        assertFalse(service.validFormUrl("https://fixture.test"))
        assertFalse(service.availableForReconciliation())
        verifyNoInteractions(readiness, configurations, versions, links, box, testBox, bank, attempts, commands)
    }
}
