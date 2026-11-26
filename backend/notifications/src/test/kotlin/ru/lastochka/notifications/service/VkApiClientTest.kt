package ru.lastochka.notifications.service

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URLDecoder
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.mock.env.MockEnvironment
import tools.jackson.databind.json.JsonMapper

class VkApiClientTest {
    @Test
    fun `filters conversations across pages and requires an acknowledgement for the correct peer`() {
        val requests = mutableListOf<Pair<String, Map<String, String>>>()
        var response = ""
        var sendStatus = 200
        val peer = 2_000_000_007L
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/method/") { exchange ->
            val method = exchange.requestURI.path.substringAfterLast('/')
            assertNull(exchange.requestURI.rawQuery)
            val params =
                exchange.requestBody.readAllBytes().toString(Charsets.UTF_8).split('&').associate {
                    entry ->
                    val (key, value) = entry.split('=', limit = 2)
                    key to URLDecoder.decode(value, Charsets.UTF_8)
                }
            requests.add(method to params)
            val payload =
                when (method) {
                    "groups.getTokenPermissions" ->
                        """{"response":{"permissions":[{"name":"messages"}]}}"""
                    "groups.getById" -> """{"response":{"groups":[{"id":99}]}}"""
                    "messages.getConversations" -> {
                        val personal = """{"conversation":{"peer":{"id":123,"type":"user"}}}"""
                        val chat =
                            """{"conversation":{"peer":{"id":$peer,"type":"chat"},"chat_settings":{"title":"Рабочая беседа"}}}"""
                        val items =
                            if (params["offset"] == "0") List(100) { personal }.joinToString(",")
                            else chat
                        """{"response":{"count":101,"items":[$items]}}"""
                    }
                    else -> response
                }.toByteArray()
            exchange.sendResponseHeaders(
                if (method == "messages.send") sendStatus else 200,
                payload.size.toLong(),
            )
            exchange.responseBody.use { it.write(payload) }
        }
        server.start()
        try {
            val client =
                VkApiClient(
                    "http://127.0.0.1:${server.address.port}/method/",
                    JsonMapper.builder().build(),
                    MockEnvironment().apply { setActiveProfiles("test") },
                )
            val key = "fixture+encoded"
            assertEquals(99L, client.community(key))
            assertEquals(listOf(peer), client.conversations(key, 99).map { it.id })
            assertEquals(
                listOf("99", "99"),
                requests.filter { it.first == "messages.getConversations" }.map { it.second["group_id"] },
            )
            response =
                """{"response":[{"peer_id":$peer,"message_id":0,"conversation_message_id":11}]}"""
            assertEquals(11L, client.send(key, peer, 7, "Проверка").messageId)
            assertEquals("1", requests.last().second["dont_parse_links"])
            assertEquals(key, requests.last().second["access_token"])
            response =
                """{"response":[{"peer_id":123,"message_id":2,"conversation_message_id":11}]}"""
            assertNull(client.send(key, peer, 7, "Проверка").messageId)
            response =
                """{"response":[{"peer_id":$peer,"message_id":0,"conversation_message_id":0,"error":{"code":917,"description":"No access"}}]}"""
            assertEquals("VK_CHAT_UNAVAILABLE", client.send(key, peer, 7, "Проверка").error)
            sendStatus = 429
            assertTrue(client.send(key, peer, 7, "Проверка").temporary)
            assertEquals(
                listOf("0", "100"),
                requests
                    .filter { it.first == "messages.getConversations" }
                    .map { it.second["offset"] },
            )
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun `classifies the same VK error equally for the whole request and for one recipient`() {
        val peer = 2_000_000_007L
        var response = ""
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/method/") { exchange ->
            val payload = response.toByteArray()
            exchange.sendResponseHeaders(200, payload.size.toLong())
            exchange.responseBody.use { it.write(payload) }
        }
        server.start()
        try {
            val client =
                VkApiClient(
                    "http://127.0.0.1:${server.address.port}/method/",
                    JsonMapper.builder().build(),
                    MockEnvironment().apply { setActiveProfiles("test") },
                )
            fun check(code: Int, reason: String, temporary: Boolean) {
                val bodies =
                    mapOf(
                        "request" to """{"error":{"error_code":$code,"error_msg":"x"}}""",
                        "recipient" to
                            """{"response":[{"peer_id":$peer,"message_id":0,"conversation_message_id":0,"error":{"code":$code,"description":"x"}}]}""",
                    )
                for ((level, body) in bodies) {
                    response = body
                    val sent = client.send("key", peer, 7, "Проверка")
                    assertNull(sent.messageId, "$level $code")
                    assertEquals(reason, sent.error, "$level $code")
                    assertEquals(temporary, sent.temporary, "$level $code")
                }
            }
            for (code in listOf(1, 10)) check(code, "VK_API_UNAVAILABLE", true)
            for (code in listOf(6, 9, 29)) check(code, "VK_LIMITED", true)
            for (code in listOf(5, 27)) check(code, "VK_BAD_KEY", false)
            for (code in listOf(7, 901, 917, 925, 936)) check(code, "VK_CHAT_UNAVAILABLE", false)
            for (code in listOf(14, 15, 100, 912, 914)) check(code, "VK_REJECTED", false)
        } finally {
            server.stop(0)
        }
    }
}
