package ru.lastochka.integration

import java.net.CookieManager
import java.net.CookiePolicy
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.postgresql.PostgreSQLContainer
import ru.lastochka.identity.service.AccountService
import tools.jackson.databind.json.JsonMapper

@ActiveProfiles("test")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = ["lastochka.workers.enabled=false"])
class AlfaUnavailableKeyHttpIntegrationTest {
    companion object {
        private val db = PostgreSQLContainer("postgres:17.6-alpine").apply { start() }
        @JvmStatic @DynamicPropertySource fun database(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url") { db.jdbcUrl }
            registry.add("spring.datasource.username") { db.username }
            registry.add("spring.datasource.password") { db.password }
            registry.add("lastochka.alfa.enabled") { true }
            registry.add("lastochka.alfa.key-directory") { "/nonexistent-alfa-key-fixture-${UUID.randomUUID()}" }
            registry.add("lastochka.alfa.key-id") { "v1" }
        }
        @JvmStatic @AfterAll fun stop() = db.stop()
    }

    @LocalServerPort var port: Int = 0
    @Autowired lateinit var accounts: AccountService
    @Autowired lateinit var jdbc: JdbcClient

    @Test
    fun `missing backend key rejects candidate without stopping authenticated draft creation or reads`() {
        val login = "fixture${UUID.randomUUID().toString().take(8)}"
        val password = "Fixture-password-2026"
        accounts.createAdmin(login, "Fixture", password)
        val json = JsonMapper.builder().build()
        val client = HttpClient.newBuilder().cookieHandler(CookieManager(null, CookiePolicy.ACCEPT_ALL)).build()
        val base = "http://127.0.0.1:$port/lastochka"
        fun get(path: String) = client.send(HttpRequest.newBuilder(URI.create(base + path)).GET().build(), HttpResponse.BodyHandlers.ofString())
        fun post(path: String, payload: String, token: String) = client.send(
            HttpRequest.newBuilder(URI.create(base + path)).header("Content-Type", "application/json")
                .header("X-CSRF-TOKEN", token).POST(HttpRequest.BodyPublishers.ofString(payload)).build(),
            HttpResponse.BodyHandlers.ofString(),
        )
        fun csrf(): String {
            val response = get("/api/v1/auth/csrf")
            assertEquals(200, response.statusCode())
            return json.readTree(response.body()).get("token").asText()
        }
        val loginResult = post("/api/v1/auth/password-stage", """{"login":"$login","password":"$password"}""", csrf())
        assertEquals(200, loginResult.statusCode())
        val token = csrf()
        val denied = post("/api/v1/admin/alfa-config/candidate", """{"login":"synthetic-login","password":"synthetic-secret","testConfirmed":true}""", token)
        assertEquals(409, denied.statusCode())
        assertFalse(denied.body().contains("synthetic-secret"))
        assertEquals(0L, jdbc.sql("select count(*) from alfa_credentials_versions").query(Long::class.java).single())
        val created = post("/api/v1/admin/payment-requests", """{"amountMinor":12345,"purpose":"Synthetic fixture","recipientName":"Fixture","phone":"+79001234567"}""", token)
        assertEquals(200, created.statusCode())
        val id = json.readTree(created.body()).get("id").asText()
        val read = get("/api/v1/admin/payment-requests/$id")
        assertEquals(200, read.statusCode())
        assertEquals(12345, json.readTree(read.body()).get("amountMinor").asInt())
        assertEquals("DRAFT", json.readTree(read.body()).get("status").asText())
    }
}
