package ru.lastochka.payments.alfa

import java.time.Clock
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.web.server.ResponseStatusException
import ru.lastochka.common.service.CommandService
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.identity.service.StaffAccessService
import ru.lastochka.payments.dto.PaymentView
import ru.lastochka.payments.entity.AlfaGatewaySelectionEntity
import ru.lastochka.payments.repo.AlfaGatewaySelectionRepository
import ru.lastochka.payments.repo.AlfaTestAttemptQueries
import ru.lastochka.payments.repo.PaymentRepository
import ru.lastochka.payments.service.AlfaTestPaymentService

class AlfaGatewaySelectionTest {
    @Test fun `selection is explicit and rejects stale and unsupported commands`() {
        val repository = mock(AlfaGatewaySelectionRepository::class.java)
        val state = AlfaGatewaySelectionEntity()
        `when`(repository.findById(1)).thenReturn(Optional.of(state))
        val test = mock(AlfaConfigurationService::class.java)
        `when`(test.activeVersion()).thenReturn(UUID.randomUUID())
        val commands = mock(CommandService::class.java)
        val prod = mock(AlfaProductionConfigurationService::class.java)
        val selection = AlfaGatewaySelection(repository, test, prod,
            commands, mock(LoginSessionService::class.java), Clock.systemUTC())
        assertNull(selection.view().activeEnvironment)
        assertFalse(selection.testSelected())
        val result = selection.select(UUID.randomUUID(), AlfaGatewaySelectionRequest(AlfaGatewayEnvironment.TEST, 0, false))
        assertEquals(AlfaGatewayEnvironment.TEST, result.activeEnvironment)
        assertEquals(1, result.revision)
        assertThrows(ResponseStatusException::class.java) {
            selection.select(UUID.randomUUID(), AlfaGatewaySelectionRequest(null, 0, false))
        }
        assertThrows(ResponseStatusException::class.java) {
            selection.select(UUID.randomUUID(), AlfaGatewaySelectionRequest(AlfaGatewayEnvironment.PRODUCTION, 1, true))
        }
        assertTrue(selection.testSelected())
        `when`(prod.activeVersion()).thenReturn(UUID.randomUUID())
        assertThrows(ResponseStatusException::class.java) {
            selection.select(UUID.randomUUID(), AlfaGatewaySelectionRequest(AlfaGatewayEnvironment.PRODUCTION, 1, false))
        }
        val production = selection.select(UUID.randomUUID(), AlfaGatewaySelectionRequest(AlfaGatewayEnvironment.PRODUCTION, 1, true))
        assertEquals(AlfaGatewayEnvironment.PRODUCTION, production.activeEnvironment)
        assertTrue(selection.productionSelected())
        assertFalse(selection.testSelected())
    }

    @Test fun `old test issue route refuses when test gateway is not selected`() {
        val actor = UUID.randomUUID(); val id = UUID.randomUUID()
        val attempts = mock(AlfaTestAttemptQueries::class.java)
        val payments = mock(PaymentRepository::class.java)
        val config = mock(AlfaConfigurationService::class.java)
        val bank = mock(AlfaBankGateway::class.java)
        val tx = mock(PlatformTransactionManager::class.java)
        val selection = mock(AlfaGatewaySelection::class.java)
        doAnswer { SimpleTransactionStatus() }.`when`(tx).getTransaction(any())
        `when`(payments.find(id)).thenReturn(PaymentView(id, 100, "Тест", "Родитель", "+79000000000", null, 1, Instant.EPOCH))
        `when`(attempts.findById(id)).thenReturn(Optional.empty())
        val service = AlfaTestPaymentService(attempts, payments, config, bank, mock(CommandService::class.java),
            mock(StaffAccessService::class.java), Clock.systemUTC(), tx, "https://fixture.test/return", "https://fixture.test", false, selection)
        assertThrows(ResponseStatusException::class.java) { service.issue(actor, id, 1) }
        verifyNoInteractions(bank, config)
        verify(attempts).findById(id)
        verifyNoMoreInteractions(attempts)
    }
}
