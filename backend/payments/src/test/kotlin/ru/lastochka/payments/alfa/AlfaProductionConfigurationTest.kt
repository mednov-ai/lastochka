package ru.lastochka.payments.alfa

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
import org.springframework.web.server.ResponseStatusException
import ru.lastochka.common.service.CommandService
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.payments.entity.AlfaConfigurationEntity
import ru.lastochka.payments.entity.AlfaCredentialsEntity
import ru.lastochka.payments.entity.AlfaTestAttemptEntity
import ru.lastochka.payments.repo.AlfaConfigurationRepository
import ru.lastochka.payments.repo.AlfaCredentialsRepository
import ru.lastochka.payments.repo.AlfaLinkRotationRepository
import ru.lastochka.payments.repo.AlfaTestAttemptQueries

class AlfaProductionConfigurationTest {
    @TempDir lateinit var directory: Path

    @Test fun `candidate remains separate while access probe is unconfirmed`() {
        val prodDir = Files.createDirectory(directory.resolve("prod"))
        val testDir = Files.createDirectory(directory.resolve("test"))
        Files.writeString(prodDir.resolve("prod.key"), Base64.getEncoder().encodeToString(ByteArray(32) { 3 }))
        Files.writeString(testDir.resolve("test.key"), Base64.getEncoder().encodeToString(ByteArray(32) { 4 }))
        val prodBox = AlfaProductionSecretBox(prodDir.toString(), "prod")
        val testBox = AlfaSecretBox(testDir.toString(), "test")
        val policy = mock(AlfaProductionPolicy::class.java)
        `when`(policy.productionAllowed()).thenReturn(true)
        val readiness = mock(AlfaProductionReadiness::class.java)
        `when`(readiness.obstacles()).thenReturn(setOf(AlfaProductionObstacle.FISCALIZATION_UNCONFIRMED))
        val repository = mock(AlfaConfigurationRepository::class.java)
        val current = AlfaConfigurationEntity(id = 2, environment = "PRODUCTION")
        `when`(repository.findById(2)).thenReturn(Optional.of(current))
        val versions = mock(AlfaCredentialsRepository::class.java)
        val stored = mutableMapOf<UUID, AlfaCredentialsEntity>()
        `when`(versions.countByEnvironment("PRODUCTION")).thenReturn(0)
        `when`(versions.save(any<AlfaCredentialsEntity>())).thenAnswer { call ->
            call.getArgument<AlfaCredentialsEntity>(0).also { stored[it.id] = it }
        }
        `when`(versions.findById(any())).thenAnswer { Optional.ofNullable(stored[it.getArgument(0)]) }
        val bank = mock(AlfaProductionHttpGateway::class.java)
        val commands = mock(CommandService::class.java)
        val links = mock(AlfaLinkRotationRepository::class.java)
        val linkId = UUID.randomUUID()
        val originalLink = prodBox.seal("https://fixture.test/link".toByteArray(), "link")
        `when`(links.withProductionLinks()).thenReturn(listOf(AlfaTestAttemptEntity(paymentId = linkId, environment = "PRODUCTION", linkCiphertext = originalLink)))
        `when`(links.replaceLink(org.mockito.ArgumentMatchers.eq(linkId) ?: linkId, org.mockito.ArgumentMatchers.any(ByteArray::class.java) ?: byteArrayOf())).thenReturn(1)
        val service = AlfaProductionConfigurationService(policy, readiness, repository, versions, links, prodBox, testBox,
            bank, mock(AlfaTestAttemptQueries::class.java), commands, mock(LoginSessionService::class.java),
            Clock.systemUTC(), mock(PlatformTransactionManager::class.java), false)
        val result = service.candidate(UUID.randomUUID(), AlfaProductionCandidateRequest("synthetic-login", "synthetic-password", true))
        assertTrue(result.candidatePresent)
        assertFalse(result.activationReady)
        assertFalse(result.toString().contains("synthetic-login"))
        assertFalse(result.toString().contains("synthetic-password"))
        val auditArguments = mockingDetails(commands).invocations.filter { it.method.name == "audit" }
            .flatMap { it.arguments.toList() }.joinToString()
        assertFalse(auditArguments.contains("synthetic-login"))
        assertFalse(auditArguments.contains("synthetic-password"))
        assertNull(current.activeVersion)
        val version = requireNotNull(current.candidateVersion)
        assertEquals("PRODUCTION", stored[version]?.environment)
        assertFalse(requireNotNull(stored[version]).ciphertext.toString(Charsets.UTF_8).contains("synthetic-password"))
        assertEquals("synthetic-login", service.credentials(version).login)
        assertThrows(Exception::class.java) { testBox.open(requireNotNull(stored[version]).ciphertext, "credentials") }
        service.checkCandidate(UUID.randomUUID())
        assertNull(current.activeVersion)
        assertNull(service.activeVersion())
        verifyNoInteractions(bank)
        Files.writeString(prodDir.resolve("new.key"), Base64.getEncoder().encodeToString(ByteArray(32) { 5 }))
        Files.writeString(prodDir.resolve("reused.key"), Base64.getEncoder().encodeToString(ByteArray(32) { 4 }))
        `when`(versions.findAllByEnvironment("PRODUCTION")).thenAnswer { stored.values.toList() }
        assertThrows(ResponseStatusException::class.java) { service.rotateKey(UUID.randomUUID(), "reused") }
        assertEquals("prod", current.currentKeyId)
        service.rotateKey(UUID.randomUUID(), "new")
        assertEquals("new", current.currentKeyId)
        val rotated = AlfaProductionSecretBox(prodDir.toString(), "new")
        val opened = rotated.open(requireNotNull(stored[version]).ciphertext, "credentials")
        assertTrue(opened.isNotEmpty())
        opened.fill(0)
        val linkCaptor = org.mockito.ArgumentCaptor.forClass(ByteArray::class.java)
        verify(links).replaceLink(org.mockito.ArgumentMatchers.eq(linkId) ?: linkId, linkCaptor.capture() ?: byteArrayOf())
        assertEquals("https://fixture.test/link", rotated.open(linkCaptor.value, "link").toString(Charsets.UTF_8))
        verify(links, never()).withLinks()
        verify(versions, never()).findAllByEnvironment("TEST")
    }

    @Test fun `production credentials cannot decrypt a TEST version`() {
        val prodDir = Files.createDirectory(directory.resolve("prod"))
        Files.writeString(prodDir.resolve("prod.key"), Base64.getEncoder().encodeToString(ByteArray(32) { 3 }))
        val policy = mock(AlfaProductionPolicy::class.java)
        `when`(policy.productionAllowed()).thenReturn(true)
        val versions = mock(AlfaCredentialsRepository::class.java)
        val id = UUID.randomUUID()
        `when`(versions.findById(id)).thenReturn(Optional.of(AlfaCredentialsEntity(id, byteArrayOf(1), Instant.EPOCH, UUID.randomUUID(), "TEST")))
        val service = AlfaProductionConfigurationService(policy, mock(AlfaProductionReadiness::class.java),
            mock(AlfaConfigurationRepository::class.java), versions, mock(AlfaLinkRotationRepository::class.java), AlfaProductionSecretBox(prodDir.toString(), "prod"),
            mock(AlfaSecretBox::class.java), mock(AlfaProductionHttpGateway::class.java), mock(AlfaTestAttemptQueries::class.java),
            mock(CommandService::class.java), mock(LoginSessionService::class.java), Clock.systemUTC(),
            mock(PlatformTransactionManager::class.java), false)
        assertThrows(IllegalStateException::class.java) { service.credentials(id) }
    }
}
