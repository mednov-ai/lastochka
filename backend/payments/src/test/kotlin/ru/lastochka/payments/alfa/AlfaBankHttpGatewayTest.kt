package ru.lastochka.payments.alfa

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import tools.jackson.databind.json.JsonMapper

class AlfaBankHttpGatewayTest {
    @Test
    fun `registration sends bank ruble currency explicitly`() {
        val params = alfaRegistrationParameters("fixture-order", 100, "https://test.example/return")
        assertEquals("810", params["currency"])
        assertEquals("100", params["amount"])
        assertEquals("fixture-order", params["orderNumber"])
    }

    @Test
    fun `no verified trust material or merchant never sends requests`() {
        val client = AlfaBankHttpGateway(JsonMapper.builder().build(), "")
        val credentials = AlfaCredentials("not-a-real-login", "not-a-real-password")
        val error = assertThrows(IllegalStateException::class.java) {
            client.status(credentials, null, "order-1")
        }
        assertEquals("TEST bank request failed", error.message)
        assertThrows(IllegalStateException::class.java) { client.decline(credentials, "order-1", null) }
    }
}
