package ru.lastochka.payments.alfa

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.web.server.ResponseStatusException
import ru.lastochka.payments.repo.AlfaTestAttemptQueries

class AlfaPaymentCompatibilityTest {
    @Test fun `old clients are blocked as soon as production is selected`() {
        val selection = mock(AlfaGatewaySelection::class.java)
        val attempts = mock(AlfaTestAttemptQueries::class.java)
        `when`(selection.productionSelected()).thenReturn(true)
        val guard = AlfaPaymentCompatibility(selection, attempts)
        assertThrows(ResponseStatusException::class.java) { guard.requireCompatible(null) }
        assertDoesNotThrow { guard.requireCompatible("2") }
        assertThrows(ResponseStatusException::class.java) { guard.requireProductionClient(null) }
    }

    @Test fun `old clients cannot see historical production attempts after switch to test`() {
        val selection = mock(AlfaGatewaySelection::class.java)
        val attempts = mock(AlfaTestAttemptQueries::class.java)
        `when`(attempts.existsByEnvironment("PRODUCTION")).thenReturn(true)
        val guard = AlfaPaymentCompatibility(selection, attempts)
        assertThrows(ResponseStatusException::class.java) { guard.requireCompatible(null) }
        assertDoesNotThrow { guard.requireCompatible("2") }
    }
}
