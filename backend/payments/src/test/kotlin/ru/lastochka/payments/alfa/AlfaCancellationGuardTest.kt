package ru.lastochka.payments.alfa

import java.time.Clock
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import org.springframework.web.server.ResponseStatusException
import ru.lastochka.common.service.CommandService
import ru.lastochka.identity.service.StaffAccessService
import ru.lastochka.payments.dto.PaymentView
import ru.lastochka.payments.entity.AlfaTestAttemptEntity
import ru.lastochka.payments.repo.AlfaTestAttemptQueries
import ru.lastochka.payments.repo.PaymentRepository
import ru.lastochka.payments.service.AlfaTestPaymentService

class AlfaCancellationGuardTest {
    @Test fun `unconfirmed cancellation never sends bank command even when merchant exists`() {
        checkGuard(confirmed = false, merchant = "old-merchant")
    }

    @Test fun `missing merchant never sends bank command even when flag is on`() {
        checkGuard(confirmed = true, merchant = null)
    }

    private fun checkGuard(confirmed: Boolean, merchant: String?) {
        val actor = UUID.randomUUID()
        val payment = UUID.randomUUID()
        val version = UUID.randomUUID()
        val attempts = mock(AlfaTestAttemptQueries::class.java)
        val payments = mock(PaymentRepository::class.java)
        val config = mock(AlfaConfigurationService::class.java)
        val bank = mock(AlfaBankGateway::class.java)
        val tx = mock(PlatformTransactionManager::class.java)
        doAnswer { SimpleTransactionStatus() }.`when`(tx).getTransaction(any())
        `when`(payments.find(payment)).thenReturn(PaymentView(payment, 100, "Тест", "Родитель", "+79000000000", null, 1, Instant.EPOCH))
        `when`(attempts.findById(payment)).thenReturn(Optional.of(AlfaTestAttemptEntity(paymentId = payment, configVersion = version)))
        `when`(config.activeVersion()).thenReturn(version)
        `when`(config.credentials(version)).thenReturn(AlfaCredentials("test-login", "test-password", merchant))
        val service = AlfaTestPaymentService(attempts, payments, config, bank, mock(CommandService::class.java),
            mock(StaffAccessService::class.java), Clock.systemUTC(), tx, "https://test.example/return", "https://test.example", confirmed, mock(AlfaGatewaySelection::class.java))

        assertThrows(ResponseStatusException::class.java) { service.cancel(actor, payment, 1) }
        verifyNoInteractions(bank)
        verify(attempts, never()).requestCancel(payment)
    }
}
