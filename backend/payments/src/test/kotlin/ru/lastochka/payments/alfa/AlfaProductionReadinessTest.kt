package ru.lastochka.payments.alfa

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*

class AlfaProductionReadinessTest {
    @Test fun `test prohibition is checked before key access`() {
        val policy = mock(AlfaProductionPolicy::class.java)
        val prod = mock(AlfaProductionSecretBox::class.java)
        val test = mock(AlfaSecretBox::class.java)
        val readiness = AlfaProductionReadiness(policy, prod, test, false, true, true, "bank.test", "810", "", "", "")
        assertEquals(setOf(AlfaProductionObstacle.FORBIDDEN), readiness.obstacles())
        verifyNoInteractions(prod, test)
    }

    @Test fun `unconfirmed fiscalization is an independent production blocker`() {
        val policy = mock(AlfaProductionPolicy::class.java)
        val prod = mock(AlfaProductionSecretBox::class.java)
        val test = mock(AlfaSecretBox::class.java)
        `when`(policy.productionAllowed()).thenReturn(true)
        `when`(prod.available()).thenReturn(true)
        `when`(test.available()).thenReturn(false)
        val readiness = AlfaProductionReadiness(policy, prod, test, false, true, false, "fixture.test", "810", "", "", "")
        assertTrue(AlfaProductionObstacle.FISCALIZATION_UNCONFIRMED in readiness.obstacles())
    }

    @Test fun `production verification must be explicitly confirmed`() {
        val policy = mock(AlfaProductionPolicy::class.java)
        val prod = mock(AlfaProductionSecretBox::class.java)
        val test = mock(AlfaSecretBox::class.java)
        `when`(policy.productionAllowed()).thenReturn(true)
        val pending = AlfaProductionReadiness(policy, prod, test, false, true, true, "fixture.test", "810", "", "", "")
        val confirmed = AlfaProductionReadiness(policy, prod, test, true, true, true, "fixture.test", "810", "", "", "")
        assertTrue(AlfaProductionObstacle.IMPLEMENTATION_UNVERIFIED in pending.obstacles())
        assertFalse(AlfaProductionObstacle.IMPLEMENTATION_UNVERIFIED in confirmed.obstacles())
    }

    @Test fun `same key material cannot be reused between environments`() {
        val policy = mock(AlfaProductionPolicy::class.java)
        val prod = mock(AlfaProductionSecretBox::class.java)
        val test = mock(AlfaSecretBox::class.java)
        `when`(policy.productionAllowed()).thenReturn(true)
        `when`(prod.available()).thenReturn(true)
        `when`(test.available()).thenReturn(true)
        `when`(prod.sharesActiveKeyWith(test)).thenReturn(true)
        val readiness = AlfaProductionReadiness(policy, prod, test, false, true, true, "fixture.test", "810", "", "", "")
        assertTrue(AlfaProductionObstacle.KEY_REUSED in readiness.obstacles())
        assertTrue(AlfaProductionObstacle.IMPLEMENTATION_UNVERIFIED in readiness.obstacles())
    }
}
