package ru.lastochka.payments.alfa

import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import tools.jackson.databind.json.JsonMapper

/** Opt-in only: one real sandbox order, never run as part of ordinary tests. */
@EnabledIfEnvironmentVariable(named = "LASTOCHKA_RUN_ALFA_REAL_TEST", matches = "YES")
class AlfaRealSandboxManualTest {
    @Test
    fun `real test merchant registers and reconciles one ruble order`() {
        val login = requireNotNull(System.getenv("LASTOCHKA_REAL_TEST_LOGIN"))
        val password = requireNotNull(System.getenv("LASTOCHKA_REAL_TEST_PASSWORD"))
        val number = requireNotNull(System.getenv("LASTOCHKA_REAL_TEST_ORDER"))
        val stateFile = Path.of(requireNotNull(System.getenv("LASTOCHKA_REAL_TEST_STATE")))
        val ca = requireNotNull(System.getenv("LASTOCHKA_REAL_TEST_CA"))
        check(login.endsWith("-api", ignoreCase = true) && number.startsWith("lsttest") && Files.isRegularFile(stateFile))
        val mapper = JsonMapper.builder().build()
        val gateway = AlfaBankHttpGateway(mapper, ca)
        val credentials = AlfaCredentials(login, password)
        val registered = gateway.register(credentials, number, 100, "https://play-and-say.ru/lastochka/payments/test/return")
        val state = mutableMapOf<String, Any?>(
            "orderNumber" to number, "environment" to "TEST", "amountMinor" to 100,
            "registration" to mapOf("body" to mapOf("orderId" to registered.orderId, "formUrl" to registered.formUrl, "errorCode" to registered.errorCode)),
        )
        Files.writeString(stateFile, mapper.writeValueAsString(state))
        assertTrue(registered.errorCode == null || registered.errorCode == "0")
        assertFalse(registered.orderId.isNullOrBlank())
        assertFalse(registered.formUrl.isNullOrBlank())
        val status = gateway.status(credentials, registered.orderId, null)
        state["statusResponse"] = mapOf("body" to mapOf(
            "orderNumber" to status.orderNumber, "orderId" to status.orderId, "orderStatus" to status.orderStatus,
            "currency" to status.currency, "amount" to status.amountMinor, "errorCode" to status.errorCode,
        ))
        Files.writeString(stateFile, mapper.writeValueAsString(state))
        assertEquals("0", status.errorCode)
        assertEquals(number, status.orderNumber)
        assertEquals(100L, status.amountMinor)
        assertEquals("810", status.currency)
        assertEquals(0, status.orderStatus)
    }
}
