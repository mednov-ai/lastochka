package ru.lastochka.payments.utils

import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class AlfaReturnUrlTest {
    private val origin = "https://example.test"
    private val path = "/lastochka/payments/test/return"

    @Test fun `exact public HTTPS origin and route are accepted`() {
        assertTrue(AlfaReturnUrl.allowed(origin + path, origin))
        assertTrue(AlfaReturnUrl.allowed("https://EXAMPLE.test:443$path", origin))
        assertTrue(AlfaReturnUrl.allowed("https://example.test:8443$path", "https://example.test:8443"))
    }

    @Test fun `untrusted origin route parameters credentials and port are rejected`() {
        val invalid = listOf(
            "http://example.test$path",
            "https://other.test$path",
            "https://example.test.attacker.test$path",
            "https://example.test@attacker.test$path",
            "https://example.test:8443$path",
            "https://example.test$path?target=other",
            "https://example.test$path?",
            "https://example.test$path#part",
            "https://example.test$path/",
            "https://example.test/lastochka/payments/test/%72eturn",
            "https://example.test/lastochka/../lastochka/payments/test/return",
            "https://example.test/anything",
        )
        invalid.forEach { assertFalse(AlfaReturnUrl.allowed(it, origin), it) }
        assertFalse(AlfaReturnUrl.allowed(origin + path, "http://example.test"))
        assertFalse(AlfaReturnUrl.allowed(origin + path, "https://example.test/other"))
        assertFalse(AlfaReturnUrl.allowed(origin + path, "https://user@example.test"))
    }
}
