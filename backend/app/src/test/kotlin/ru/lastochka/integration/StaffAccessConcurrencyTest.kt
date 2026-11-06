package ru.lastochka.integration

import java.net.CookieManager
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.concurrent.CompletableFuture
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
class StaffAccessConcurrencyTest {
    companion object {
        private val db = PostgreSQLContainer("postgres:17.6-alpine").apply { start() }
        @JvmStatic @DynamicPropertySource
        fun database(r: DynamicPropertyRegistry) {
            r.add("spring.datasource.url") { db.jdbcUrl }
            r.add("spring.datasource.username") { db.username }
            r.add("spring.datasource.password") { db.password }
        }
    }
    @Autowired lateinit var accounts: AccountService
    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var json: JsonMapper
    @LocalServerPort var port: Int = 0

    private fun client() = HttpClient.newBuilder().cookieHandler(CookieManager()).build()
    private fun request(client: HttpClient, method: String, path: String, body: Any? = null): HttpResponse<String> {
        val builder = HttpRequest.newBuilder(URI("http://localhost:$port/lastochka$path"))
        if (method != "GET") {
            val token = json.readTree(request(client, "GET", "/api/v1/auth/csrf").body())
            builder.header(token.path("headerName").asString(), token.path("token").asString())
        }
        if (body != null) builder.header("Content-Type", "application/json")
        return client.send(builder.method(method, if (body == null) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(), HttpResponse.BodyHandlers.ofString())
    }

    @Test
    fun `concurrent edits conflict and concurrent demotions preserve an administrator`() {
        val first = accounts.createAdmin("staffrace1", "Первый", "Test-pass-2026")
        val second = accounts.createAdmin("staffrace2", "Второй", "Test-pass-2026")
        val a = client()
        val b = client()
        assertEquals(200, request(a, "POST", "/api/v1/auth/password-stage", mapOf("login" to first.login, "password" to "Test-pass-2026")).statusCode())
        assertEquals(200, request(b, "POST", "/api/v1/auth/password-stage", mapOf("login" to second.login, "password" to "Test-pass-2026")).statusCode())
        val created = request(a, "POST", "/api/v1/admin/users", mapOf("name" to "Сотрудник", "login" to "staffrace", "role" to "STAFF", "permissions" to emptyList<String>(), "temporaryPassword" to "Temp-pass-2026"))
        assertEquals(201, created.statusCode(), created.body())
        val id = json.readTree(created.body()).path("id").asString()
        fun update(c: HttpClient, target: String, rights: List<String>) = request(c, "PUT", "/api/v1/admin/users/$target/access", mapOf("role" to "STAFF", "permissions" to rights, "revision" to 0)).statusCode()
        val editA = CompletableFuture.supplyAsync { update(a, id, listOf("SCHEDULE_VIEW")) }
        val editB = CompletableFuture.supplyAsync { update(b, id, listOf("PAYMENT_VIEW")) }
        assertEquals(listOf(200, 409), listOf(editA.join(), editB.join()).sorted())
        val removeA = CompletableFuture.supplyAsync { update(a, second.id.toString(), emptyList()) }
        val removeB = CompletableFuture.supplyAsync { update(b, first.id.toString(), emptyList()) }
        val outcomes = listOf(removeA.join(), removeB.join())
        assertEquals(1, outcomes.count { it == 200 }, outcomes.toString())
        assertTrue(outcomes.all { it == 200 || it == 403 || it == 409 }, outcomes.toString())
        assertEquals(1L, jdbc.sql("SELECT count(*) FROM accounts WHERE role='ADMIN' AND admin_enabled=true").query(Long::class.java).single())
    }
}
