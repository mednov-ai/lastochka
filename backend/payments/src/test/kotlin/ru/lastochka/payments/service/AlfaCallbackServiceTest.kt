package ru.lastochka.payments.service

import java.nio.file.Files
import java.nio.file.Path
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset
import java.util.Base64
import java.util.HexFormat
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.mockito.Mockito.*
import ru.lastochka.payments.alfa.AlfaConfigurationService
import ru.lastochka.payments.entity.AlfaTestAttemptEntity
import ru.lastochka.payments.repo.AlfaTestAttemptQueries

class AlfaCallbackServiceTest {
    @TempDir lateinit var directory: Path
    private val key = ByteArray(32) { 0x0b }
    private val params = mapOf(
        "amount" to "123456", "mdOrder" to "3ff6962a-7dcc-4283-ab50-a6d7dd3386fe",
        "operation" to "deposited", "orderNumber" to "10747", "status" to "1",
    )

    @Test fun `bank canonical form and HMAC are stable`() {
        val actual = HexFormat.of().formatHex(AlfaCallbackService.checksum(params, key))
        assertEquals("e0f723f5b68e2f7dcea34af2dcf8fc9da9993a93cdd6092ae2edebcecb5cb826", actual)
        assertArrayEquals(AlfaCallbackService.checksum(params, key), AlfaCallbackService.checksum(params + ("checksum" to "ignored"), key))
    }

    @Test fun `only a valid confirmed callback schedules once`() {
        val file = directory.resolve("callback.key")
        Files.writeString(file, Base64.getEncoder().encodeToString(key))
        val repo = mock(AlfaTestAttemptQueries::class.java)
        val config = mock(AlfaConfigurationService::class.java)
        val id = UUID.randomUUID()
        val bankId = params.getValue("mdOrder")
        `when`(config.activeVersion()).thenReturn(UUID.randomUUID())
        `when`(repo.findByOrderNumber("10747")).thenReturn(AlfaTestAttemptEntity(paymentId = id, orderId = bankId))
        val signature = AlfaCallbackService.checksum(params, key)
        val digest = HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(signature))
        `when`(repo.acceptCallback(digest, id)).thenReturn(1, 0)
        val service = AlfaCallbackService(repo, config, Clock.fixed(Instant.parse("2026-11-06T12:00:00Z"), ZoneOffset.UTC), true, file.toString())
        val signed = (params + ("checksum" to HexFormat.of().formatHex(AlfaCallbackService.checksum(params, key)))).mapValues { listOf(it.value) }
        assertTrue(service.accept(signed))
        assertTrue(service.accept(signed))
        verify(repo, times(1)).scheduleCallback(id, Instant.parse("2026-11-06T12:00:00Z"))
        assertFalse(service.accept(signed + ("status" to listOf("1", "0"))))
        assertFalse(service.accept(signed + ("amount" to listOf("999"))))
        assertFalse(AlfaCallbackService(repo, config, Clock.systemUTC(), false, file.toString()).accept(signed))
    }
}
