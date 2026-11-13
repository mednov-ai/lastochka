package ru.lastochka.payments.alfa

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import org.springframework.core.env.SystemEnvironmentPropertySource
import ru.lastochka.payments.repo.AlfaConfigurationRepository

class AlfaProductionPolicyTest {
    private fun database(vararg zones: String): AlfaConfigurationRepository = mock(AlfaConfigurationRepository::class.java).also {
        `when`(it.deploymentEnvironments()).thenReturn(zones.toList())
    }

    @Test fun `disabled by default never reads database identity`() {
        val source = mock(AlfaConfigurationRepository::class.java)
        assertFalse(AlfaProductionPolicy(source, false, "test").productionAllowed())
        verifyNoInteractions(source)
    }

    @Test fun `production requires both declared deployment and database identity`() {
        assertTrue(AlfaProductionPolicy(database("production"), true, "production").productionAllowed())
        assertThrows(IllegalStateException::class.java) { AlfaProductionPolicy(database("test"), true, "production") }
        assertThrows(IllegalStateException::class.java) { AlfaProductionPolicy(database("production"), true, "test") }
        assertThrows(IllegalStateException::class.java) { AlfaProductionPolicy(database("production"), true, "unknown") }
    }

    @Test fun `higher priority environment override cannot enable production on test`() {
        val source = database("test")
        ApplicationContextRunner()
            .withPropertyValues("lastochka.alfa.production-allowed=false", "lastochka.alfa.deployment-zone=production")
            .withInitializer { context ->
                context.environment.propertySources.addFirst(SystemEnvironmentPropertySource("fixture-env", mapOf(
                    "LASTOCHKA_ALFA_PRODUCTION_ALLOWED" to "true", "LASTOCHKA_ALFA_DEPLOYMENT_ZONE" to "production",
                )))
            }
            .withBean(AlfaConfigurationRepository::class.java, java.util.function.Supplier { source })
            .withBean(AlfaProductionPolicy::class.java)
            .run { context ->
                val failure = requireNotNull(context.startupFailure)
                val messages = generateSequence<Throwable>(failure) { it.cause }.mapNotNull { it.message }.joinToString(" ")
                assertTrue(messages.contains("Alfa production forbidden for this database"), messages)
            }
        verify(source).deploymentEnvironments()
    }

    @Test fun `missing or ambiguous identity never enables production`() {
        assertThrows(IllegalStateException::class.java) { AlfaProductionPolicy(database(), true, "production") }
        assertThrows(IllegalStateException::class.java) { AlfaProductionPolicy(database("production", "production"), true, "production") }
        val missing = mock(AlfaConfigurationRepository::class.java)
        `when`(missing.deploymentEnvironments()).thenThrow(IllegalStateException("missing"))
        assertThrows(IllegalStateException::class.java) { AlfaProductionPolicy(missing, true, "production") }
    }
}
