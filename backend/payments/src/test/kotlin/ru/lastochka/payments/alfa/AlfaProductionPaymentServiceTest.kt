package ru.lastochka.payments.alfa

import java.time.Clock
import java.time.Instant
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers.any
import org.mockito.ArgumentMatchers.eq
import org.mockito.ArgumentMatchers.anyString
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
import ru.lastochka.payments.service.AlfaProductionPaymentService

class AlfaProductionPaymentServiceTest {
    @Test fun `unconfirmed production cancellation cannot reach the bank`() {
        val id = UUID.randomUUID(); val actor = UUID.randomUUID(); val version = UUID.randomUUID()
        val attempts = mock(AlfaTestAttemptQueries::class.java)
        val payments = mock(PaymentRepository::class.java)
        val config = mock(AlfaProductionConfigurationService::class.java)
        val bank = mock(AlfaProductionHttpGateway::class.java)
        val transactions = mock(PlatformTransactionManager::class.java)
        val policy = mock(AlfaProductionPolicy::class.java)
        `when`(policy.productionAllowed()).thenReturn(true)
        doAnswer { SimpleTransactionStatus() }.`when`(transactions).getTransaction(any())
        val payment = PaymentView(id, 100, "Тест", "Родитель", "+79000000000", null, 1, Instant.EPOCH)
        `when`(payments.find(id)).thenReturn(payment)
        `when`(attempts.findById(id)).thenReturn(Optional.of(AlfaTestAttemptEntity(paymentId = id, configVersion = version, environment = "PRODUCTION")))
        `when`(config.availableForReconciliation()).thenReturn(true)
        val service = AlfaProductionPaymentService(attempts, payments, config, bank, mock(CommandService::class.java),
            mock(StaffAccessService::class.java), Clock.systemUTC(), transactions, "https://fixture.test/payments/return",
            "https://fixture.test", false, mock(AlfaGatewaySelection::class.java), policy)
        assertThrows(ResponseStatusException::class.java) { service.cancel(actor, id, 1) }
        verifyNoInteractions(bank)
        verify(config, never()).credentials(version)
        verify(attempts, never()).requestCancel(id)
        assertFalse(service.decorate(payment.copy(operationState = "OPEN", bankStatus = "REGISTERED")).canCancel)
    }

    @Test fun `late contradictory status cannot rewrite a cancelled order`() {
        val id = UUID.randomUUID(); val actor = UUID.randomUUID(); val version = UUID.randomUUID()
        val attempts = mock(AlfaTestAttemptQueries::class.java)
        val payments = mock(PaymentRepository::class.java)
        val config = mock(AlfaProductionConfigurationService::class.java)
        val bank = mock(AlfaProductionHttpGateway::class.java)
        val transactions = mock(PlatformTransactionManager::class.java)
        val policy = mock(AlfaProductionPolicy::class.java)
        val credentials = AlfaCredentials("fixture", "fixture")
        val now = Instant.parse("2026-01-01T00:00:00Z")
        val row = AlfaTestAttemptEntity(paymentId = id, configVersion = version, orderNumber = "fixture-order",
            orderId = "fixture-bank-id", amountMinor = 100, currency = "643", environment = "PRODUCTION",
            operationState = "CANCELLED", revision = 7)
        `when`(policy.productionAllowed()).thenReturn(true)
        doAnswer { SimpleTransactionStatus() }.`when`(transactions).getTransaction(any())
        `when`(payments.find(id)).thenReturn(PaymentView(id, 100, "Тест", "Родитель", "+79000000000", null, 1, Instant.EPOCH))
        `when`(attempts.findById(id)).thenReturn(Optional.of(row))
        `when`(attempts.claim(id, now, now.plusSeconds(120))).thenReturn(1)
        `when`(config.availableForReconciliation()).thenReturn(true)
        `when`(config.credentials(version)).thenReturn(credentials)
        `when`(bank.status(credentials, row.orderId, row.orderNumber)).thenReturn(
            AlfaStatusResult(row.orderNumber, row.orderId, 100, "643", 2, "0"))
        val service = AlfaProductionPaymentService(attempts, payments, config, bank, mock(CommandService::class.java),
            mock(StaffAccessService::class.java), Clock.fixed(now, java.time.ZoneOffset.UTC), transactions,
            "https://fixture.test/payments/return", "https://fixture.test", false, mock(AlfaGatewaySelection::class.java), policy)
        service.refresh(actor, id, 1)
        verify(attempts).statusError(id, 7L, now.plusSeconds(300))
        assertTrue(mockingDetails(attempts).invocations.none { it.method.name == "statusResult" })
    }

    @Test fun `successful production registration stores only the encrypted allowed link`() {
        val id = UUID.randomUUID(); val actor = UUID.randomUUID(); val version = UUID.randomUUID()
        val attempts = mock(AlfaTestAttemptQueries::class.java)
        val payments = mock(PaymentRepository::class.java)
        val config = mock(AlfaProductionConfigurationService::class.java)
        val bank = mock(AlfaProductionHttpGateway::class.java)
        val selection = mock(AlfaGatewaySelection::class.java)
        val transactions = mock(PlatformTransactionManager::class.java)
        val policy = mock(AlfaProductionPolicy::class.java)
        val credentials = AlfaCredentials("fixture", "fixture")
        val row = AlfaTestAttemptEntity(paymentId = id, configVersion = version, orderNumber = "fixture-order",
            amountMinor = 100, currency = "643", environment = "PRODUCTION")
        val url = "https://fixture-bank.test/link"
        val encrypted = byteArrayOf(1, 2, 3)
        `when`(policy.productionAllowed()).thenReturn(true)
        `when`(selection.productionSelected()).thenReturn(true)
        doAnswer { SimpleTransactionStatus() }.`when`(transactions).getTransaction(any())
        `when`(payments.find(id)).thenReturn(PaymentView(id, 100, "Тест", "Родитель", "+79000000000", null, 1, Instant.EPOCH))
        `when`(attempts.findById(id)).thenReturn(Optional.empty(), Optional.of(row))
        `when`(config.activeVersion()).thenReturn(version)
        `when`(config.credentials(version)).thenReturn(credentials)
        `when`(config.validFormUrl(url)).thenReturn(true)
        `when`(config.encryptLink(url)).thenReturn(encrypted)
        `when`(bank.currency).thenReturn("643")
        `when`(attempts.createProduction(eq(id) ?: id, eq(version) ?: version, anyString() ?: "",
            eq(1L), eq(100L), eq("Тест") ?: "Тест", eq("643") ?: "643")).thenReturn(1)
        `when`(attempts.registrationResult(id, "fixture-bank-id", encrypted, "OPEN", null)).thenReturn(1)
        `when`(bank.register(credentials, row.orderNumber, 100, "https://fixture.test/payments/return"))
            .thenAnswer {
                // Viewing/selection may change while the bank is processing an already issued order.
                `when`(selection.productionSelected()).thenReturn(false)
                AlfaRegisterResult("fixture-bank-id", url, null)
            }
        val service = AlfaProductionPaymentService(attempts, payments, config, bank, mock(CommandService::class.java),
            mock(StaffAccessService::class.java), Clock.systemUTC(), transactions, "https://fixture.test/payments/return",
            "https://fixture.test", false, selection, policy)
        service.issue(actor, id, 1)
        verify(attempts).registrationResult(id, "fixture-bank-id", encrypted, "OPEN", null)
        assertFalse(selection.productionSelected())
    }

    @Test fun `lost production registration response is unknown and retry does not duplicate it`() {
        val id = UUID.randomUUID(); val actor = UUID.randomUUID(); val version = UUID.randomUUID()
        val attempts = mock(AlfaTestAttemptQueries::class.java)
        val payments = mock(PaymentRepository::class.java)
        val config = mock(AlfaProductionConfigurationService::class.java)
        val bank = mock(AlfaProductionHttpGateway::class.java)
        val selection = mock(AlfaGatewaySelection::class.java)
        val transactions = mock(PlatformTransactionManager::class.java)
        val policy = mock(AlfaProductionPolicy::class.java)
        val credentials = AlfaCredentials("fixture", "fixture")
        val row = AlfaTestAttemptEntity(paymentId = id, configVersion = version, orderNumber = "fixture-order",
            amountMinor = 100, currency = "643", environment = "PRODUCTION")
        `when`(policy.productionAllowed()).thenReturn(true)
        `when`(selection.productionSelected()).thenReturn(true)
        doAnswer { SimpleTransactionStatus() }.`when`(transactions).getTransaction(any())
        `when`(payments.find(id)).thenReturn(PaymentView(id, 100, "Тест", "Родитель", "+79000000000", null, 1, Instant.EPOCH))
        `when`(attempts.findById(id)).thenReturn(Optional.empty(), Optional.of(row), Optional.of(row))
        `when`(config.activeVersion()).thenReturn(version)
        `when`(config.credentials(version)).thenReturn(credentials)
        `when`(bank.currency).thenReturn("643")
        `when`(attempts.createProduction(eq(id) ?: id, eq(version) ?: version, anyString() ?: "",
            eq(1L), eq(100L), eq("Тест") ?: "Тест", eq("643") ?: "643")).thenReturn(1)
        `when`(bank.register(credentials, row.orderNumber, 100, "https://fixture.test/payments/return"))
            .thenThrow(IllegalStateException("fixture network loss"))
        val service = AlfaProductionPaymentService(attempts, payments, config, bank, mock(CommandService::class.java),
            mock(StaffAccessService::class.java), Clock.systemUTC(), transactions, "https://fixture.test/payments/return",
            "https://fixture.test", false, selection, policy)
        service.issue(actor, id, 1)
        service.issue(actor, id, 1)
        verify(bank, times(1)).register(credentials, row.orderNumber, 100, "https://fixture.test/payments/return")
        verify(attempts).registrationResult(id, null, null, "UNKNOWN", "BANK_UNAVAILABLE")
    }

    @Test fun `confirmed bank reversal is stored as cancelled`() {
        val id = UUID.randomUUID(); val actor = UUID.randomUUID(); val version = UUID.randomUUID()
        val attempts = mock(AlfaTestAttemptQueries::class.java)
        val payments = mock(PaymentRepository::class.java)
        val config = mock(AlfaProductionConfigurationService::class.java)
        val bank = mock(AlfaProductionHttpGateway::class.java)
        val transactions = mock(PlatformTransactionManager::class.java)
        val policy = mock(AlfaProductionPolicy::class.java)
        val credentials = AlfaCredentials("fixture", "fixture")
        val now = Instant.parse("2026-01-01T00:00:00Z")
        val row = AlfaTestAttemptEntity(paymentId = id, configVersion = version, orderNumber = "fixture-order",
            orderId = "fixture-bank-id", amountMinor = 100, currency = "643", environment = "PRODUCTION", revision = 7)
        `when`(policy.productionAllowed()).thenReturn(true)
        doAnswer { SimpleTransactionStatus() }.`when`(transactions).getTransaction(any())
        `when`(payments.find(id)).thenReturn(PaymentView(id, 100, "Тест", "Родитель", "+79000000000", null, 1, Instant.EPOCH))
        `when`(attempts.findById(id)).thenReturn(Optional.of(row))
        `when`(attempts.claim(id, now, now.plusSeconds(120))).thenReturn(1)
        `when`(config.availableForReconciliation()).thenReturn(true)
        `when`(config.credentials(version)).thenReturn(credentials)
        `when`(bank.status(credentials, row.orderId, row.orderNumber)).thenReturn(
            AlfaStatusResult(row.orderNumber, row.orderId, 100, "643", 3, "0"))
        val service = AlfaProductionPaymentService(attempts, payments, config, bank, mock(CommandService::class.java),
            mock(StaffAccessService::class.java), Clock.fixed(now, java.time.ZoneOffset.UTC), transactions,
            "https://fixture.test/payments/return", "https://fixture.test", false, mock(AlfaGatewaySelection::class.java), policy)
        service.refresh(actor, id, 1)
        verify(attempts).statusResult(id, 7, row.orderId, "CANCELLED", "CANCELLED", now, now.plusSeconds(300))
    }

    @Test fun `production reconciliation rejects a different bank currency`() {
        val id = UUID.randomUUID()
        val actor = UUID.randomUUID()
        val version = UUID.randomUUID()
        val attempts = mock(AlfaTestAttemptQueries::class.java)
        val payments = mock(PaymentRepository::class.java)
        val config = mock(AlfaProductionConfigurationService::class.java)
        val bank = mock(AlfaProductionHttpGateway::class.java)
        val transactions = mock(PlatformTransactionManager::class.java)
        val policy = mock(AlfaProductionPolicy::class.java)
        val credentials = AlfaCredentials("fixture", "fixture")
        val now = Instant.parse("2026-01-01T00:00:00Z")
        val row = AlfaTestAttemptEntity(paymentId = id, configVersion = version, orderNumber = "fixture-order",
            orderId = "fixture-bank-id", amountMinor = 100, currency = "643", environment = "PRODUCTION", revision = 7)
        `when`(policy.productionAllowed()).thenReturn(true)
        doAnswer { SimpleTransactionStatus() }.`when`(transactions).getTransaction(any())
        `when`(payments.find(id)).thenReturn(PaymentView(id, 100, "Тест", "Родитель", "+79000000000", null, 1, Instant.EPOCH))
        `when`(attempts.findById(id)).thenReturn(Optional.of(row))
        `when`(attempts.claim(id, now, now.plusSeconds(120))).thenReturn(1)
        `when`(config.availableForReconciliation()).thenReturn(true)
        `when`(config.credentials(version)).thenReturn(credentials)
        `when`(bank.status(credentials, row.orderId, row.orderNumber)).thenReturn(
            AlfaStatusResult(row.orderNumber, row.orderId, 100, "810", 2, "0"))
        val service = AlfaProductionPaymentService(attempts, payments, config, bank, mock(CommandService::class.java),
            mock(StaffAccessService::class.java), Clock.fixed(now, java.time.ZoneOffset.UTC), transactions, "https://fixture.test/payments/return", "https://fixture.test", false,
            mock(AlfaGatewaySelection::class.java), policy)
        service.refresh(actor, id, 1)
        verify(attempts).statusError(id, 7L, now.plusSeconds(300))
        assertTrue(mockingDetails(attempts).invocations.none { it.method.name == "statusResult" })
    }

    @Test fun `test attempt never reaches production bank even if production is selected`() {
        val id = UUID.randomUUID()
        val actor = UUID.randomUUID()
        val version = UUID.randomUUID()
        val attempts = mock(AlfaTestAttemptQueries::class.java)
        val payments = mock(PaymentRepository::class.java)
        val config = mock(AlfaProductionConfigurationService::class.java)
        val bank = mock(AlfaProductionHttpGateway::class.java)
        val selection = mock(AlfaGatewaySelection::class.java)
        val transactions = mock(PlatformTransactionManager::class.java)
        val policy = mock(AlfaProductionPolicy::class.java)
        `when`(policy.productionAllowed()).thenReturn(true)
        doAnswer { SimpleTransactionStatus() }.`when`(transactions).getTransaction(any())
        `when`(payments.find(id)).thenReturn(PaymentView(id, 100, "Тест", "Родитель", "+79000000000", null, 1, Instant.EPOCH))
        `when`(attempts.findById(id)).thenReturn(Optional.of(AlfaTestAttemptEntity(paymentId = id, configVersion = version, environment = "TEST")))
        `when`(config.activeVersion()).thenReturn(version)
        `when`(config.availableForReconciliation()).thenReturn(true)
        val service = AlfaProductionPaymentService(attempts, payments, config, bank, mock(CommandService::class.java),
            mock(StaffAccessService::class.java), Clock.systemUTC(), transactions, "https://fixture.test/payments/return", "https://fixture.test", false,
            selection, policy)
        assertThrows(ResponseStatusException::class.java) { service.refresh(actor, id, 1) }
        verify(attempts).findById(id)
        verifyNoInteractions(bank)
        verify(config, never()).credentials(version)
    }

    @Test fun `forbidden production scheduler does not query attempts or bank`() {
        val attempts = mock(AlfaTestAttemptQueries::class.java)
        val config = mock(AlfaProductionConfigurationService::class.java)
        val bank = mock(AlfaProductionHttpGateway::class.java)
        val service = AlfaProductionPaymentService(attempts, mock(PaymentRepository::class.java), config, bank,
            mock(CommandService::class.java), mock(StaffAccessService::class.java), Clock.systemUTC(), mock(PlatformTransactionManager::class.java),
            "https://fixture.test/payments/return", "https://fixture.test", false, mock(AlfaGatewaySelection::class.java),
            mock(AlfaProductionPolicy::class.java))
        val id = UUID.randomUUID()
        val actor = UUID.randomUUID()
        assertThrows(ResponseStatusException::class.java) { service.issue(actor, id, 1) }
        assertThrows(ResponseStatusException::class.java) { service.refresh(actor, id, 1) }
        assertThrows(ResponseStatusException::class.java) { service.cancel(actor, id, 1) }
        assertThrows(ResponseStatusException::class.java) { service.archive(actor, id, 1) }
        assertThrows(ResponseStatusException::class.java) { service.link(actor, id) }
        service.poll()
        verifyNoInteractions(attempts, config, bank)
    }
}
