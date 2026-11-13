package ru.lastochka.payments.alfa

import java.time.Clock
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import ru.lastochka.common.service.CommandService
import ru.lastochka.payments.repo.AlfaConfigurationRepository
import ru.lastochka.payments.repo.AlfaCredentialsRepository
import ru.lastochka.payments.repo.AlfaLinkRotationRepository
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.payments.repo.AlfaTestAttemptQueries
import org.springframework.transaction.PlatformTransactionManager

class AlfaFormUrlTest {
    @Test
    fun `production form allowlist rejects lookalikes and insecure URLs`() {
        val policy = mock(AlfaProductionPolicy::class.java)
        `when`(policy.productionAllowed()).thenReturn(true)
        val service = AlfaProductionConfigurationService(policy, mock(AlfaProductionReadiness::class.java),
            mock(AlfaConfigurationRepository::class.java), mock(AlfaCredentialsRepository::class.java),
            mock(AlfaLinkRotationRepository::class.java), mock(AlfaProductionSecretBox::class.java),
            mock(AlfaSecretBox::class.java), mock(AlfaProductionHttpGateway::class.java), mock(AlfaTestAttemptQueries::class.java),
            mock(CommandService::class.java), mock(LoginSessionService::class.java), Clock.systemUTC(),
            mock(PlatformTransactionManager::class.java), false, "safe.example")
        assertTrue(service.validFormUrl("https://safe.example/payment/123"))
        assertFalse(service.validFormUrl("http://safe.example/payment/123"))
        assertFalse(service.validFormUrl("https://safe.example.attacker.test/payment/123"))
        assertFalse(service.validFormUrl("https://safe.example@attacker.test/payment/123"))
        assertFalse(service.validFormUrl("https://safe.example:444/payment/123"))
        assertFalse(service.validFormUrl("https://safe.example/payment/123#secret"))
    }

    @Test
    fun `only allow-listed HTTPS hosts on standard port are accepted`() {
        fun service(hosts: String) = AlfaConfigurationService(
            mock(AlfaConfigurationRepository::class.java), mock(AlfaCredentialsRepository::class.java),
            mock(AlfaLinkRotationRepository::class.java),
            mock(AlfaSecretBox::class.java), mock(CommandService::class.java), mock(LoginSessionService::class.java),
            mock(AlfaBankGateway::class.java), mock(AlfaTestAttemptQueries::class.java), Clock.systemUTC(),
            mock(PlatformTransactionManager::class.java), false, false, hosts,
        )
        assertFalse(service("").validFormUrl("https://safe.example/payment/123"))
        val configured = service("safe.example")
        assertTrue(configured.validFormUrl("https://safe.example/payment/123"))
        assertFalse(configured.validFormUrl("http://safe.example/payment/123"))
        assertFalse(configured.validFormUrl("https://safe.example.attacker.test/payment/123"))
        assertFalse(configured.validFormUrl("https://safe.example@attacker.test/payment/123"))
        assertFalse(configured.validFormUrl("https://safe.example:444/payment/123"))
        assertFalse(configured.validFormUrl("https://safe.example/payment/123#secret"))
    }
}
