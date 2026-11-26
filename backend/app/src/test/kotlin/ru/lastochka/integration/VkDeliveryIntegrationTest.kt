package ru.lastochka.integration

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URLDecoder
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.web.server.ResponseStatusException
import org.testcontainers.postgresql.PostgreSQLContainer
import ru.lastochka.enquiries.dto.EnquiryInput
import ru.lastochka.enquiries.service.EnquiryService
import ru.lastochka.identity.service.AccountService
import ru.lastochka.notifications.service.VkDelivery
import ru.lastochka.notifications.service.VkSettingsService

/** The database and the VK endpoint are disposable; no external request is made. */
@ActiveProfiles("test")
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["lastochka.workers.enabled=false"],
)
class VkDeliveryIntegrationTest {
    companion object {
        private const val FIRST_CHAT = 2_000_000_007L
        private const val SECOND_CHAT = 2_000_000_008L
        private val db = PostgreSQLContainer("postgres:17.6-alpine").apply { start() }
        private val keys: Path = Files.createTempDirectory("vk-delivery-test")
        private val lookups = CopyOnWriteArrayList<Pair<String?, String?>>()
        private val sends = CopyOnWriteArrayList<Map<String, String>>()
        @Volatile private var reply: (String) -> String = ::accepted

        private fun accepted(peer: String) =
            """{"response":[{"peer_id":$peer,"message_id":0,"conversation_message_id":11}]}"""

        private fun rejected(code: Int): (String) -> String = { peer ->
            """{"response":[{"peer_id":$peer,"message_id":0,"conversation_message_id":0,"error":{"code":$code,"description":"x"}}]}"""
        }

        private val vk =
            HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0).apply {
                createContext("/method/") { exchange ->
                    val params =
                        exchange.requestBody
                            .readAllBytes()
                            .toString(Charsets.UTF_8)
                            .split('&')
                            .associate {
                                val (key, value) = it.split('=', limit = 2)
                                key to URLDecoder.decode(value, Charsets.UTF_8)
                            }
                    fun chat(id: Long) =
                        """{"conversation":{"peer":{"id":$id,"type":"chat"},"chat_settings":{"title":"Беседа $id"}}}"""
                    val payload =
                        when (exchange.requestURI.path.substringAfterLast('/')) {
                            "groups.getTokenPermissions" ->
                                """{"response":{"mask":4096,"permissions":[{"name":"messages"}]}}"""
                            "groups.getById" -> {
                                val group = if (params["access_token"] == "replacement-token") 101 else 99
                                """{"response":{"groups":[{"id":$group}]}}"""
                            }
                            "messages.getConversations" -> {
                                lookups.add(params["access_token"] to params["group_id"])
                                """{"response":{"count":2,"items":[${chat(FIRST_CHAT)},${chat(SECOND_CHAT)}]}}"""
                            }
                            else -> {
                                sends.add(params)
                                reply(params.getValue("peer_ids"))
                            }
                        }.toByteArray()
                    exchange.sendResponseHeaders(200, payload.size.toLong())
                    exchange.responseBody.use { it.write(payload) }
                }
                start()
            }

        @JvmStatic
        @DynamicPropertySource
        fun properties(registry: DynamicPropertyRegistry) {
            Files.writeString(
                keys.resolve("fixture.key"),
                Base64.getEncoder().encodeToString(ByteArray(32) { 1 }),
            )
            registry.add("spring.datasource.url") { db.jdbcUrl }
            registry.add("spring.datasource.username") { db.username }
            registry.add("spring.datasource.password") { db.password }
            registry.add("lastochka.vk.key-directory") { keys.toString() }
            registry.add("lastochka.vk.key-id") { "fixture" }
            registry.add("lastochka.vk.environment") { "test" }
            registry.add("lastochka.vk.api-url") { "http://127.0.0.1:${vk.address.port}/method/" }
        }

        @JvmStatic
        @AfterAll
        fun stop() {
            vk.stop(0)
            db.stop()
            keys.toFile().deleteRecursively()
        }
    }

    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var accounts: AccountService
    @Autowired lateinit var enquiries: EnquiryService
    @Autowired lateinit var settings: VkSettingsService
    @Autowired lateinit var delivery: VkDelivery

    private lateinit var actor: UUID

    @BeforeEach
    fun connect() {
        reply = ::accepted
        jdbc.sql("DELETE FROM vk_enquiry_outbox").update()
        actor =
            accounts
                .createAdmin(
                    "admin" + UUID.randomUUID().toString().take(8),
                    "Администратор",
                    "Test-pass-2026",
                )
                .id
        use(FIRST_CHAT)
        sends.clear()
    }

    private fun use(chat: Long) {
        var view = settings.saveKey(settings.get().version, "fixture-token", actor)
        view = settings.choose(view.version, chat, actor)
        view = settings.test(view.version, actor)
        assertEquals("VERIFIED", view.testStatus)
        settings.toggle(view.version, true, actor)
    }

    private fun submit(): UUID {
        val number =
            enquiries
                .submit(
                    UUID.randomUUID(),
                    EnquiryInput("Мария", "+79001234567", comment = "Личный комментарий"),
                )
                .number
        return jdbc
            .sql("SELECT id FROM enrollment_requests WHERE public_number=:number")
            .param("number", number)
            .query(UUID::class.java)
            .single()
    }

    private fun process() {
        // The database container clock can differ from the JVM clock.
        jdbc.sql("UPDATE vk_enquiry_outbox SET next_attempt_at=now()-interval '1 second'").update()
        delivery.processNext()
    }

    private fun column(id: UUID, name: String): String? =
        jdbc
            .sql("SELECT coalesce($name::text,'') FROM vk_enquiry_outbox WHERE enquiry_id=:id")
            .param("id", id)
            .query(String::class.java)
            .optional()
            .orElse(null)

    @Test
    fun `discovery keeps key and community paired across replacements`() {
        lookups.clear()
        var view = settings.get()
        settings.chats(view.version)
        view = settings.saveKey(view.version, "replacement-token", actor)
        settings.chats(view.version)
        view = settings.choose(view.version, SECOND_CHAT, actor)
        assertEquals(
            listOf("fixture-token" to "99", "replacement-token" to "101", "replacement-token" to "101"),
            lookups.toList(),
        )

        jdbc.sql("UPDATE vk_enquiry_settings SET draft_group = NULL").update()
        assertThrows<ResponseStatusException> { settings.chats(view.version) }
        assertEquals(3, lookups.size)
    }

    @Test
    fun `accepted message contains only the number and the protected card link`() {
        val id = submit()
        process()
        process()
        val sent = sends.single()
        val number = column(id, "enquiry_number")
        assertEquals(FIRST_CHAT.toString(), sent["peer_ids"])
        assertTrue(
            Regex("Новая заявка №$number\\nhttps?://\\S+/admin/requests\\?enquiry=$id")
                .matches(sent.getValue("message"))
        )
        assertEquals("DELIVERED", delivery.view(id).status)
        assertEquals("11", column(id, "message_id"))
        assertThrows<ResponseStatusException> { delivery.retry(id, actor) }
    }

    @Test
    fun `temporary recipient error is retried later with the same random id`() {
        val id = submit()
        reply = rejected(10)
        process()
        assertEquals("RETRY_WAIT", delivery.view(id).status)
        assertEquals("VK_API_UNAVAILABLE", delivery.view(id).error)
        delivery.processNext()
        assertEquals(1, sends.size, "The backoff must postpone the next attempt")
        reply = ::accepted
        process()
        assertEquals("DELIVERED", delivery.view(id).status)
        assertEquals(2, sends.size)
        assertEquals(1, sends.map { it["random_id"] }.distinct().size)
    }

    @Test
    fun `exhausted delivery stops and one manual retry delivers it`() {
        val id = submit()
        reply = rejected(6)
        repeat(9) { process() }
        assertEquals(8, sends.size)
        assertEquals("FAILED", delivery.view(id).status)
        assertTrue(delivery.view(id).canRetry)
        reply = ::accepted
        delivery.retry(id, actor)
        assertThrows<ResponseStatusException> { delivery.retry(id, actor) }
        process()
        assertEquals("DELIVERED", delivery.view(id).status)
        assertEquals(1, sends.map { it["random_id"] }.distinct().size)
    }

    @Test
    fun `permanent recipient error fails without automatic retries`() {
        val id = submit()
        reply = rejected(917)
        process()
        process()
        assertEquals(1, sends.size)
        assertEquals("FAILED", delivery.view(id).status)
        assertEquals("VK_CHAT_UNAVAILABLE", delivery.view(id).error)
    }

    @Test
    fun `changed conversation stops the pending message and receives new ones`() {
        val old = submit()
        use(SECOND_CHAT)
        sends.clear()
        process()
        assertTrue(sends.isEmpty())
        assertEquals("STOPPED", delivery.view(old).status)
        assertFalse(delivery.view(old).canRetry)
        val fresh = submit()
        process()
        assertEquals(SECOND_CHAT.toString(), sends.single()["peer_ids"])
        assertEquals("DELIVERED", delivery.view(fresh).status)
    }

    @Test
    fun `replaced key of the same conversation keeps the pending message`() {
        val id = submit()
        use(FIRST_CHAT)
        sends.clear()
        process()
        assertEquals("DELIVERED", delivery.view(id).status)
    }

    @Test
    fun `disabled channel keeps queued messages and does not queue new ones`() {
        val queued = submit()
        settings.toggle(settings.get().version, false, actor)
        val skipped = submit()
        assertNull(column(skipped, "status"))
        assertEquals("NOT_SELECTED", delivery.view(skipped).status)
        process()
        assertEquals("DELIVERED", delivery.view(queued).status)
    }

    @Test
    fun `message abandoned by a stopped worker is sent again after its lease`() {
        val id = submit()
        jdbc
            .sql("UPDATE vk_enquiry_outbox SET attempts=1,lease_until=now()+interval '1 minute'")
            .update()
        process()
        assertTrue(sends.isEmpty())
        assertEquals("SENDING", delivery.view(id).status)
        jdbc
            .sql("UPDATE vk_enquiry_outbox SET lease_until=:past")
            .param("past", java.sql.Timestamp.from(Instant.now().minusSeconds(60)))
            .update()
        process()
        assertEquals("DELIVERED", delivery.view(id).status)
        assertEquals(1, sends.size)
    }

    @Test
    fun `failed test of a new conversation keeps the working one`() {
        var view = settings.saveKey(settings.get().version, "replacement-token", actor)
        view = settings.choose(view.version, SECOND_CHAT, actor)
        reply = rejected(917)
        view = settings.test(view.version, actor)
        assertEquals("FAILED", view.testStatus)
        assertThrows<ResponseStatusException> { settings.toggle(view.version, true, actor) }
        assertEquals(FIRST_CHAT, settings.get().activeChat?.id)
        reply = ::accepted
        sends.clear()
        val id = submit()
        process()
        assertEquals(FIRST_CHAT.toString(), sends.single()["peer_ids"])
        assertEquals("fixture-token", sends.single()["access_token"])
        assertEquals("DELIVERED", delivery.view(id).status)
    }
}
