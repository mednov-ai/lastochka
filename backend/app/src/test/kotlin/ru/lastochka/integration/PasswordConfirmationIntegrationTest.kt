package ru.lastochka.integration

import java.net.CookieManager
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import javax.sql.DataSource
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.boot.test.system.OutputCaptureExtension
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.testcontainers.postgresql.PostgreSQLContainer
import ru.lastochka.identity.entity.Account
import ru.lastochka.identity.service.AccountService
import tools.jackson.databind.json.JsonMapper

@ExtendWith(OutputCaptureExtension::class)
@ActiveProfiles("test")
@Import(RecurringTestClockConfiguration::class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = ["lastochka.workers.enabled=false"])
class PasswordConfirmationIntegrationTest {
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
    @Autowired lateinit var dataSource: DataSource
    @Autowired lateinit var json: JsonMapper
    @LocalServerPort var port: Int = 0
    private val password = "Fixture-confirm-123"
    private fun client() = HttpClient.newBuilder().cookieHandler(CookieManager()).build()
    private fun admin(): Account = accounts.createAdmin("c" + UUID.randomUUID().toString().take(8), "Тест", password)
    @AfterEach fun resetClock() { RecurringTestClockConfiguration.now.set(null) }

    private fun request(c: HttpClient, method: String, path: String, body: Any? = null, csrf: Boolean = true): HttpResponse<String> {
        val b = HttpRequest.newBuilder(URI("http://localhost:$port/lastochka$path"))
        if (body != null) b.header("Content-Type", "application/json")
        if (method != "GET" && csrf) {
            val token = json.readTree(request(c, "GET", "/api/v1/auth/csrf").body())
            b.header(token.path("headerName").asString(), token.path("token").asString())
        }
        return c.send(b.method(method, if (body == null) HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body))).build(), HttpResponse.BodyHandlers.ofString())
    }

    private fun login(c: HttpClient, a: Account) = request(c, "POST", "/api/v1/auth/password-stage", mapOf("login" to a.login, "password" to password))
    private fun confirm(c: HttpClient, value: String = password) = request(c, "POST", "/api/v1/auth/password-confirmation", mapOf("password" to value))

    @Test fun `contract describes current-session password confirmation`() {
        val response = request(client(), "GET", "/v3/api-docs")
        assertEquals(200, response.statusCode())
        val document = json.readTree(response.body())
        val path = document.path("paths").path("/api/v1/auth/password-confirmation")
        assertTrue(path.path("get").path("security").isArray)
        assertTrue(path.path("post").path("security").isArray)
        assertTrue(document.path("components").path("schemas").path("ConfirmPasswordRequest").path("properties").path("password").path("writeOnly").asBoolean())
        System.getenv("LASTOCHKA_REAUTH_OPENAPI_EXPORT")?.let { java.nio.file.Files.writeString(java.nio.file.Path.of(it), response.body()) }
    }

    @Test fun `confirmation does not expose secrets in responses or application logs`(output: CapturedOutput) {
        val a = admin(); val c = client()
        assertEquals(200, login(c, a).statusCode())
        val wrong = "Wrong-fixture-secret-987654"
        val denied = confirm(c, wrong)
        val accepted = confirm(c)
        assertEquals(401, denied.statusCode())
        assertEquals(200, accepted.statusCode())
        for (response in listOf(denied, accepted)) {
            assertFalse(response.body().contains(wrong))
            assertFalse(response.body().contains(password))
            assertTrue(response.headers().firstValue("Cache-Control").orElse("").contains("no-store"))
        }
        assertFalse(output.all.contains(wrong))
        assertFalse(output.all.contains(password))
    }

    @Test fun `view keys without freshness while sensitive commands remain protected`() {
        for (role in listOf("ADMIN", "STAFF")) {
            val a = admin()
            if (role == "STAFF") jdbc.sql("update accounts set role='STAFF' where id=:id").param("id", a.id).update()
            val c = client()
            val start = Instant.now()
            RecurringTestClockConfiguration.now.set(start)
            assertEquals(200, login(c, a).statusCode())
            RecurringTestClockConfiguration.now.set(start.plusSeconds(300))
            val view = request(c, "GET", "/api/v1/auth/webauthn/credentials")
            assertEquals(200, view.statusCode())
            assertEquals("[]", view.body())
            assertEquals(false, json.readTree(request(c, "GET", "/api/v1/auth/password-confirmation").body()).path("fresh").asBoolean())
            assertEquals(401, request(c, "POST", "/api/v1/auth/webauthn/registration/options").statusCode())
            if (role == "ADMIN") {
                val user = request(c, "POST", "/api/v1/admin/users", mapOf("name" to "Тест", "login" to "newfixture", "temporaryPassword" to "Testpass123", "role" to "ADMIN", "permissions" to emptyList<String>()))
                assertEquals(401, user.statusCode())
                assertEquals("REAUTH_REQUIRED", json.readTree(user.body()).path("code").asString())
                val bank = request(c, "POST", "/api/v1/admin/alfa-config/disable")
                assertEquals(401, bank.statusCode())
                assertEquals("REAUTH_REQUIRED", json.readTree(bank.body()).path("code").asString())
            }
            assertEquals(401, confirm(c, "wrong-password").statusCode())
            assertEquals(200, confirm(c).statusCode())
            assertEquals(true, json.readTree(request(c, "GET", "/api/v1/auth/password-confirmation").body()).path("fresh").asBoolean())
            RecurringTestClockConfiguration.now.set(start.plusSeconds(600))
            assertEquals(false, json.readTree(request(c, "GET", "/api/v1/auth/password-confirmation").body()).path("fresh").asBoolean())
        }
        val guest = client()
        assertNotEquals(200, request(guest, "GET", "/api/v1/auth/webauthn/credentials").statusCode())
        assertNotEquals(200, confirm(guest).statusCode())
    }

    @Test fun `confirmation protects identity csrf and rate limit`() {
        val a = admin(); val c = client()
        assertEquals(200, login(c, a).statusCode())
        assertEquals(403, request(c, "POST", "/api/v1/auth/password-confirmation", mapOf("password" to password), false).statusCode())
        assertEquals(400, request(c, "POST", "/api/v1/auth/password-confirmation", mapOf("password" to password, "login" to "other")).statusCode())
        repeat(10) { assertEquals(401, confirm(c, "wrong-password").statusCode()) }
        val limited = confirm(c, "wrong-password")
        assertEquals(429, limited.statusCode())
        assertTrue(limited.headers().firstValue("Retry-After").isPresent)
        assertFalse(limited.body().contains("wrong-password"))
    }

    @Test fun `view only own keys after confirmation expired`() {
        val owner = admin(); val other = admin(); val c = client()
        for ((a, uid, key, label) in listOf(
            listOf(owner.email, "AQID", "BAUG", "Свой ключ"),
            listOf(other.email, "BwgJ", "CgsM", "Чужой ключ"),
        )) {
            jdbc.sql("insert into user_entities(id,name,display_name) values (:id,:name,'Тест')")
                .param("id", uid).param("name", a).update()
            jdbc.sql("""insert into user_credentials(credential_id,user_entity_user_id,public_key,signature_count,uv_initialized,backup_eligible,authenticator_transports,public_key_credential_type,backup_state,created,last_used,label)
                values (:key,:user,decode('aabb','hex'),0,true,false,'internal','public-key',false,now(),now(),:label)""")
                .param("key", key).param("user", uid).param("label", label).update()
        }
        val start = Instant.now(); RecurringTestClockConfiguration.now.set(start)
        assertEquals(200, login(c, owner).statusCode())
        RecurringTestClockConfiguration.now.set(start.plusSeconds(301))
        val response = request(c, "GET", "/api/v1/auth/webauthn/credentials")
        assertEquals(200, response.statusCode())
        assertTrue(response.body().contains("Свой ключ"))
        assertFalse(response.body().contains("Чужой ключ"))
    }

    @Test fun `restricted and revoked sessions cannot view keys or confirm`() {
        val restricted = admin()
        jdbc.sql("update accounts set must_change_password=true, temporary_password_expires_at=:expires where id=:id")
            .param("expires", java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC).plusSeconds(3600)).param("id", restricted.id).update()
        val limited = client()
        assertEquals(200, login(limited, restricted).statusCode())
        assertEquals(403, request(limited, "GET", "/api/v1/auth/webauthn/credentials").statusCode())
        assertEquals(403, confirm(limited).statusCode())
        val revoked = admin(); val c = client()
        assertEquals(200, login(c, revoked).statusCode())
        jdbc.sql("update accounts set admin_enabled=false where id=:id").param("id", revoked.id).update()
        assertNotEquals(200, request(c, "GET", "/api/v1/auth/webauthn/credentials").statusCode())
        assertNotEquals(200, confirm(c).statusCode())
    }

    @Test fun `account version changed during confirmation cannot grant freshness`() {
        val a = admin(); val c = client()
        assertEquals(200, login(c, a).statusCode())
        dataSource.connection.use { connection ->
            connection.autoCommit = false
            connection.prepareStatement("select id from accounts where id = ? for update").use { s -> s.setObject(1, a.id); s.executeQuery().close() }
            val result = CompletableFuture.supplyAsync { confirm(c) }
            Thread.sleep(300)
            assertFalse(result.isDone)
            connection.prepareStatement("update accounts set auth_version = auth_version + 1 where id = ?").use { s -> s.setObject(1, a.id); s.executeUpdate() }
            connection.commit()
            assertNotEquals(200, result.get(10, TimeUnit.SECONDS).statusCode())
        }
    }

    @Test fun `admission revoked during confirmation cannot grant freshness`() {
        val a = admin(); val c = client()
        assertEquals(200, login(c, a).statusCode())
        dataSource.connection.use { connection ->
            connection.autoCommit = false
            connection.prepareStatement("select id from accounts where id = ? for update").use { s -> s.setObject(1, a.id); s.executeQuery().close() }
            val result = CompletableFuture.supplyAsync { confirm(c) }
            Thread.sleep(300)
            assertFalse(result.isDone)
            connection.prepareStatement("update accounts set admin_enabled = false where id = ?").use { s -> s.setObject(1, a.id); s.executeUpdate() }
            connection.commit()
            assertNotEquals(200, result.get(10, TimeUnit.SECONDS).statusCode())
        }
    }

    @Test fun `revoked session during confirmation cannot be revived`() {
        val a = admin(); val c = client()
        assertEquals(200, login(c, a).statusCode())
        dataSource.connection.use { connection ->
            connection.autoCommit = false
            connection.prepareStatement("delete from spring_session where principal_name = ?").use { s -> s.setString(1, a.email); assertEquals(1, s.executeUpdate()) }
            val result = CompletableFuture.supplyAsync { confirm(c) }
            Thread.sleep(300)
            assertFalse(result.isDone)
            connection.commit()
            assertNotEquals(200, result.get(10, TimeUnit.SECONDS).statusCode())
        }
    }
}
