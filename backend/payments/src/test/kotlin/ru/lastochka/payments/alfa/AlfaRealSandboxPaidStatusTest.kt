package ru.lastochka.payments.alfa

import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import tools.jackson.databind.json.JsonMapper

/** Reads one previously completed sandbox order; does not issue a payment. */
@EnabledIfEnvironmentVariable(named = "LASTOCHKA_RUN_ALFA_REAL_TEST", matches = "YES")
class AlfaRealSandboxPaidStatusTest {
    @Test
    fun `client reads confirmed sandbox payment with bank ruble currency`() {
        val login = requireNotNull(System.getenv("LASTOCHKA_REAL_TEST_LOGIN"))
        val password = requireNotNull(System.getenv("LASTOCHKA_REAL_TEST_PASSWORD"))
        val ca = requireNotNull(System.getenv("LASTOCHKA_REAL_TEST_CA"))
        val file = Path.of(requireNotNull(System.getenv("LASTOCHKA_REAL_TEST_STATE")))
        val mapper = JsonMapper.builder().build()
        val doc = mapper.readTree(Files.readString(file))
        val number = doc.path("orderNumber").asString()
        val orderId = doc.path("registration").path("body").path("orderId").asString()
        check(login.endsWith("-api", ignoreCase = true) && number.startsWith("lsttest") && doc.path("environment").asString() == "TEST")
        check(doc.path("latestStatus").path("body").path("orderStatus").asInt() == 2)
        val status = AlfaBankHttpGateway(mapper, ca).status(AlfaCredentials(login, password), orderId, null)
        assertEquals("0", status.errorCode)
        assertEquals(number, status.orderNumber)
        assertEquals(100L, status.amountMinor)
        assertEquals("810", status.currency)
        assertEquals(2, status.orderStatus)
    }
}
