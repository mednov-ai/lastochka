package ru.lastochka.notifications.service

import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import ru.lastochka.notifications.dto.VkChat
import tools.jackson.databind.json.JsonMapper

class VkChatLinkServiceTest {
    private val settings = mock(VkSettingsService::class.java)
    private val actor = UUID.randomUUID()
    private val group = 99L
    private val peer = 2_000_000_007L
    private val json = JsonMapper.builder().build()
    private var now = Instant.parse("2026-11-26T10:00:00Z")
    private val clock = object : Clock() {
        override fun instant() = now
        override fun getZone(): ZoneId = ZoneOffset.UTC
        override fun withZone(zone: ZoneId): Clock = Clock.fixed(now, zone)
    }
    private val links = VkChatLinkService(settings, clock, "fixture-secret", "confirmation", group)

    private fun start(): String {
        `when`(settings.draftBelongsTo(4, group)).thenReturn(true)
        return links.start(4, actor).code
    }

    private fun event(code: String, address: Long = peer, source: Long = group, secret: String = "fixture-secret") =
        json.readTree(
            """{"type":"message_new","group_id":$source,"secret":"$secret",
                "object":{"message":{"peer_id":$address,"text":"[club99|Test group] $code"}}}""",
        )

    @Test
    fun `only an authenticated group message claims the link once`() {
        val code = start()
        val chat = VkChat(peer, "Тестовая беседа")
        `when`(settings.verifyLinkedChat(4, group, peer)).thenReturn(chat)
        assertNull(links.receive(event(code, source = 100)))
        assertNull(links.receive(event(code, secret = "different")))
        assertEquals("ok", links.receive(event(code, address = 123)))
        assertEquals("ok", links.receive(event("different", address = peer)))
        verify(settings, never()).verifyLinkedChat(4, group, peer)
        assertEquals("ok", links.receive(event(code)))
        assertEquals("ok", links.receive(event(code)))
        verify(settings, times(1)).verifyLinkedChat(4, group, peer)
        verify(settings, times(1)).linkDraft(4, group, chat, actor)
    }

    @Test
    fun `expired code and rejected lookup do not change the chat`() {
        val code = start()
        assertEquals("ok", links.receive(event(code)))
        verify(settings, times(1)).verifyLinkedChat(4, group, peer)
        now = now.plusSeconds(600)
        assertEquals("ok", links.receive(event(code)))
        verify(settings).draftBelongsTo(4, group)
        verifyNoMoreInteractions(settings)
    }
}
