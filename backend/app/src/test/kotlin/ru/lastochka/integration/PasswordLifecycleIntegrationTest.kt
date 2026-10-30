package ru.lastochka.integration

import java.net.CookieManager
import java.net.URI
import java.net.http.*
import java.time.*
import java.util.UUID
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
import ru.lastochka.identity.dto.ChangePasswordRequest
import ru.lastochka.identity.repo.UserPasswordRepository
import ru.lastochka.identity.service.*
import tools.jackson.databind.json.JsonMapper

@ActiveProfiles("test")
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties =
        [
            "lastochka.workers.enabled=false",
            "lastochka.security.login-ip-limit=1000",
            "lastochka.security.login-account-limit=1000",
        ],
)
class PasswordLifecycleIntegrationTest {
    companion object {
        private val db = PostgreSQLContainer("postgres:17.6-alpine").apply { start() }

        @JvmStatic
        @DynamicPropertySource
        fun database(r: DynamicPropertyRegistry) {
            r.add("spring.datasource.url") { db.jdbcUrl }
            r.add("spring.datasource.username") { db.username }
            r.add("spring.datasource.password") { db.password }
        }
    }

    @Autowired lateinit var accounts: AccountService
    @Autowired lateinit var access: AdminAccessService
    @Autowired lateinit var lifecycle: PasswordLifecycleService
    @Autowired lateinit var storage: UserPasswordRepository
    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var json: JsonMapper
    @LocalServerPort var port: Int = 0
    private val original = "Original-pass-2026"
    private val temporary = "Temporary-pass-2026"
    private val permanent = "Permanent-pass-2026"

    private fun client() = HttpClient.newBuilder().cookieHandler(CookieManager()).build()

    private fun admin() =
        accounts.createAdmin("p" + UUID.randomUUID().toString().take(8), "Администратор", original)

    private fun request(
        c: HttpClient,
        method: String,
        path: String,
        body: Any? = null,
        csrf: Boolean = true,
    ): HttpResponse<String> {
        val b = HttpRequest.newBuilder(URI("http://localhost:$port/lastochka$path"))
        if (body != null) b.header("Content-Type", "application/json")
        if (method != "GET" && csrf) {
            val token = json.readTree(request(c, "GET", "/api/v1/auth/csrf").body())
            b.header(token.path("headerName").asString(), token.path("token").asString())
        }
        return c.send(
            b.method(
                    method,
                    if (body == null) HttpRequest.BodyPublishers.noBody()
                    else HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)),
                )
                .build(),
            HttpResponse.BodyHandlers.ofString(),
        )
    }

    private fun login(c: HttpClient, login: String, password: String) =
        request(
            c,
            "POST",
            "/api/v1/auth/password-stage",
            mapOf("login" to login, "password" to password),
        )

    private fun state(r: HttpResponse<String>) = json.readTree(r.body()).path("state").asString()

    private fun change(
        c: HttpClient,
        current: String = temporary,
        next: String = permanent,
        confirmation: String = next,
    ) =
        request(
            c,
            "POST",
            "/api/v1/auth/change-password",
            mapOf(
                "currentPassword" to current,
                "newPassword" to next,
                "confirmPassword" to confirmation,
            ),
        )

    private fun create(
        c: HttpClient,
        login: String = "n" + UUID.randomUUID().toString().take(8),
        extra: Map<String, Any> = emptyMap(),
    ) =
        request(
            c,
            "POST",
            "/api/v1/admin/users",
            mapOf(
                "name" to "Новый администратор",
                "login" to login,
                "temporaryPassword" to temporary,
                "role" to "ADMIN",
            ) + extra,
        )

    @Test
    fun `creation first change and subsequent login form full lifecycle`() {
        val actor = admin()
        val owner = client()
        assertEquals("FULL", state(login(owner, actor.login!!, original)))
        val created = create(owner)
        assertEquals(201, created.statusCode(), created.body())
        val u = json.readTree(created.body())
        val id = UUID.fromString(u.path("id").asString())
        assertTrue(u.path("mustChangePassword").asBoolean())
        assertFalse(created.body().contains(temporary))
        assertFalse(created.body().contains("passwordHash"))
        val c = client()
        val entered = login(c, u.path("login").asString(), temporary)
        assertEquals("PASSWORD_CHANGE_REQUIRED", state(entered))
        assertEquals("no-store", entered.headers().firstValue("Cache-Control").orElse(""))
        for (path in
            listOf(
                "/api/v1/admin/users",
                "/api/v1/admin/enquiries",
                "/api/v1/auth/webauthn/credentials",
            )) {
            val denied = request(c, "GET", path)
            assertEquals(403, denied.statusCode())
            assertTrue(denied.body().contains("PASSWORD_CHANGE_REQUIRED"))
        }
        assertEquals(
            403,
            request(c, "POST", "/api/v1/auth/webauthn/register/options", emptyMap<String, String>())
                .statusCode(),
        )
        assertEquals(
            403,
            request(
                    c,
                    "POST",
                    "/api/v1/admin/sessions/${UUID.randomUUID()}/draft/publish",
                    emptyMap<String, String>(),
                )
                .statusCode(),
        )
        assertEquals(200, request(c, "GET", "/api/v1/public/landing").statusCode())
        assertEquals("FULL", state(change(c)))
        assertFalse(storage.find(id)!!.mustChangePassword)
        assertNull(storage.find(id)!!.temporaryPasswordExpiresAt)
        assertEquals(401, login(client(), u.path("login").asString(), temporary).statusCode())
        assertEquals("FULL", state(login(client(), u.path("login").asString(), permanent)))
        val audit =
            jdbc
                .sql(
                    "SELECT count(*) FROM audit_events WHERE aggregate_id=:id AND action IN ('USER_CREATED','TEMPORARY_PASSWORD_CHANGED')"
                )
                .param("id", id)
                .query(Long::class.java)
                .single()
        assertEquals(2, audit)
    }

    @Test
    fun `duplicate normalized login and unsupported roles never overwrite accounts`() {
        val a = admin()
        val c = client()
        login(c, a.login!!, original)
        val name = "u" + UUID.randomUUID().toString().take(8)
        assertEquals(201, create(c, " $name ").statusCode())
        assertEquals(409, create(c, name.uppercase()).statusCode())
        assertEquals(400, create(c, extra = mapOf("role" to "PARENT")).statusCode())
        assertEquals(400, create(c, extra = mapOf("role" to "DOCTOR")).statusCode())
        assertEquals("PASSWORD_CHANGE_REQUIRED", state(login(client(), name, temporary)))
        assertEquals(400, create(c, extra = mapOf("adminEnabled" to true)).statusCode())
    }

    @Test
    fun `self change rejects invalid input without side effects and preserves old login rules`() {
        val a = admin()
        val c = client()
        login(c, a.login!!, original)
        val before = storage.find(a.id)!!.passwordHash
        for ((current, next, confirmation, field) in
            listOf(
                listOf("wrong", permanent, permanent, "currentPassword"),
                listOf(original, "letters", "letters", "newPassword"),
                listOf(original, original, original, "newPassword"),
                listOf(original, permanent, "different", "confirmPassword"),
            )) {
            val r = change(c, current, next, confirmation)
            assertEquals(400, r.statusCode(), r.body())
            assertTrue(json.readTree(r.body()).path("fieldErrors").has(field))
            assertEquals(before, storage.find(a.id)!!.passwordHash)
        }
        assertEquals("FULL", state(change(c, original)))
    }

    @Test
    fun `reset revokes target only and blocks old webauthn until own change`() {
        val actor = admin()
        val target = admin()
        val c = client()
        val other = client()
        val old = client()
        login(c, actor.login!!, original)
        login(other, target.login!!, original)
        login(old, target.login!!, original)
        jdbc
            .sql(
                "INSERT INTO webauthn_challenges(session_id,account_id,kind,payload,expires_at) VALUES(:sid,:id,'GET','{}',now()+interval '5 minutes')"
            )
            .param("sid", UUID.randomUUID().toString())
            .param("id", target.id)
            .update()
        val reset =
            request(
                c,
                "POST",
                "/api/v1/admin/users/${target.id}/temporary-password",
                mapOf("revision" to 0, "temporaryPassword" to temporary),
            )
        assertEquals(200, reset.statusCode(), reset.body())
        assertEquals(401, request(other, "GET", "/api/v1/admin/users").statusCode())
        assertEquals(401, request(old, "GET", "/api/v1/auth/webauthn/credentials").statusCode())
        assertEquals(200, request(c, "GET", "/api/v1/admin/users").statusCode())
        assertEquals(
            0,
            jdbc
                .sql("SELECT count(*) FROM webauthn_challenges WHERE account_id=:id")
                .param("id", target.id)
                .query(Long::class.java)
                .single(),
        )
        assertEquals(
            403,
            request(
                    c,
                    "POST",
                    "/api/v1/admin/users/${actor.id}/temporary-password",
                    mapOf("revision" to 0, "temporaryPassword" to temporary),
                )
                .statusCode(),
        )
        assertEquals(
            409,
            request(
                    c,
                    "POST",
                    "/api/v1/admin/users/${target.id}/temporary-password",
                    mapOf("revision" to 0, "temporaryPassword" to temporary),
                )
                .statusCode(),
        )
        val t = client()
        assertEquals("PASSWORD_CHANGE_REQUIRED", state(login(t, target.login!!, temporary)))
        assertEquals("FULL", state(change(t)))
    }

    @Test
    fun `expiry and limited session absolute boundaries fail closed`() {
        val a = admin()
        access.reset(a.id, temporary)
        val c = client()
        assertEquals("PASSWORD_CHANGE_REQUIRED", state(login(c, a.login!!, temporary)))
        jdbc
            .sql(
                "UPDATE accounts SET temporary_password_expires_at=now()-interval '1 second' WHERE id=:id"
            )
            .param("id", a.id)
            .update()
        assertEquals(401, change(c).statusCode())
        assertEquals(401, login(client(), a.login!!, temporary).statusCode())
        access.reset(a.id, temporary)
        assertEquals("PASSWORD_CHANGE_REQUIRED", state(login(client(), a.login!!, temporary)))
    }

    @Test
    fun `parallel password mutations accept only one expected revision`() {
        val a = admin()
        val futures =
            (1..2).map { n ->
                CompletableFuture.supplyAsync {
                    runCatching {
                            lifecycle.change(
                                a.id,
                                0,
                                ChangePasswordRequest(
                                    original,
                                    "Parallel$n-pass",
                                    "Parallel$n-pass",
                                ),
                            )
                        }
                        .isSuccess
                }
            }
        assertEquals(1, futures.count { it.join() })
        assertEquals(1, storage.find(a.id)!!.authVersion)
    }

    @Test
    fun `csrf and anonymous access remain protected and secrets are write only`() {
        val a = admin()
        val c = client()
        login(c, a.login!!, original)
        assertEquals(
            403,
            request(c, "POST", "/api/v1/admin/users", emptyMap<String, String>(), false)
                .statusCode(),
        )
        assertEquals(
            403,
            request(
                    c,
                    "POST",
                    "/api/v1/admin/sessions/${UUID.randomUUID()}/draft/publish",
                    emptyMap<String, String>(),
                    false,
                )
                .statusCode(),
        )
        assertEquals(401, request(client(), "GET", "/api/v1/admin/users").statusCode())
        assertEquals(401, change(client()).statusCode())
        val list = request(c, "GET", "/api/v1/admin/users")
        assertEquals(200, list.statusCode())
        for (value in
            listOf(original, temporary, "passwordHash", "@accounts.lastochka.invalid")) assertFalse(
            list.body().contains(value)
        )
        assertEquals(400, request(c, "GET", "/api/v1/admin/users?size=101").statusCode())
    }

    @Test
    fun `operator provisioning is non destructive and reset requires first change`() {
        val a = admin()
        val hash = storage.find(a.id)!!.passwordHash
        access.provision(a.id, a.login!!)
        assertEquals(hash, storage.find(a.id)!!.passwordHash)
        access.reset(a.id, temporary)
        assertTrue(storage.find(a.id)!!.mustChangePassword)
        assertEquals("PASSWORD_CHANGE_REQUIRED", state(login(client(), a.login!!, temporary)))
    }

    @Test
    fun `audit failure rolls back password version and pending challenges`() {
        val a = admin()
        val before = storage.find(a.id)!!.passwordHash
        jdbc
            .sql(
                "CREATE FUNCTION reject_password_audit() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.action = ''PASSWORD_CHANGED'' THEN RAISE EXCEPTION ''fixture audit rejected''; END IF; RETURN NEW; END'"
            )
            .update()
        jdbc
            .sql(
                "CREATE TRIGGER reject_password_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_password_audit()"
            )
            .update()
        try {
            assertThrows(Exception::class.java) {
                lifecycle.change(a.id, 0, ChangePasswordRequest(original, permanent, permanent))
            }
            assertEquals(before, storage.find(a.id)!!.passwordHash)
            assertEquals(0, storage.find(a.id)!!.authVersion)
        } finally {
            jdbc.sql("DROP TRIGGER reject_password_audit ON audit_events").update()
            jdbc.sql("DROP FUNCTION reject_password_audit()").update()
        }
    }

    @Autowired lateinit var transactions: org.springframework.transaction.PlatformTransactionManager
    @Autowired lateinit var commands: ru.lastochka.common.service.CommandService

    @Test
    fun `command waiting behind reset cannot commit on old admission`() {
        val a = admin()
        val started = java.util.concurrent.CountDownLatch(1)
        lateinit var future: CompletableFuture<Boolean>
        org.springframework.transaction.support.TransactionTemplate(transactions).execute {
            jdbc
                .sql("SELECT id FROM studio_settings WHERE id=1 FOR UPDATE")
                .query(Int::class.java)
                .single()
            lifecycle.temporary(a.id, 0, temporary, null)
            future = CompletableFuture.supplyAsync {
                val req =
                    org.springframework.mock.web.MockHttpServletRequest(
                        "POST",
                        "/lastochka/api/v1/admin/sessions",
                    )
                req.contextPath = "/lastochka"
                req.session.setAttribute(
                    ru.lastochka.common.Metadata.Identity.AUTH_VERSION_ATTRIBUTE,
                    0L,
                )
                org.springframework.web.context.request.RequestContextHolder.setRequestAttributes(
                    org.springframework.web.context.request.ServletRequestAttributes(req)
                )
                org.springframework.security.core.context.SecurityContextHolder.getContext()
                    .authentication =
                    org.springframework.security.authentication.UsernamePasswordAuthenticationToken
                        .authenticated(a.email, null, emptyList())
                started.countDown()
                try {
                    runCatching {
                            commands.execute(
                                a.id,
                                "stale-command",
                                "stale",
                                emptyMap<String, String>(),
                                String::class.java,
                            ) {
                                "must not execute"
                            }
                        }
                        .isFailure
                } finally {
                    org.springframework.web.context.request.RequestContextHolder
                        .resetRequestAttributes()
                    org.springframework.security.core.context.SecurityContextHolder.clearContext()
                }
            }
            assertTrue(started.await(5, java.util.concurrent.TimeUnit.SECONDS))
        }
        assertTrue(future.get(10, java.util.concurrent.TimeUnit.SECONDS))
        assertEquals(
            0,
            jdbc
                .sql("SELECT count(*) FROM idempotency_records WHERE actor_id=:id")
                .param("id", a.id)
                .query(Long::class.java)
                .single(),
        )
    }

    @Test
    fun `parallel normalized login creation never replaces first hash`() {
        val a = admin()
        val first = client()
        val secondClient = client()
        login(first, a.login!!, original)
        login(secondClient, a.login!!, original)
        val name = "race" + UUID.randomUUID().toString().take(8)
        val jobs =
            listOf(first, secondClient).map { c ->
                CompletableFuture.supplyAsync { create(c, name).statusCode() }
            }
        assertEquals(listOf(201, 409), jobs.map { it.join() }.sorted())
        assertEquals("PASSWORD_CHANGE_REQUIRED", state(login(client(), name, temporary)))
    }

    @Test
    fun `wrong current password is rate limited without changing account`() {
        val a = admin()
        val c = client()
        login(c, a.login!!, original)
        val before = storage.find(a.id)!!.passwordHash
        repeat(10) { assertEquals(400, change(c, "wrong").statusCode()) }
        val blocked = change(c, "wrong")
        assertEquals(429, blocked.statusCode())
        assertTrue(blocked.headers().firstValue("Retry-After").isPresent)
        assertEquals(before, storage.find(a.id)!!.passwordHash)
    }

    @Autowired lateinit var authService: AuthService

    @Test
    fun `failure saving replacement session never rolls back committed password`() {
        val a = admin()
        val req =
            object : org.springframework.mock.web.MockHttpServletRequest() {
                override fun changeSessionId(): String =
                    throw IllegalStateException("fixture session unavailable")
            }
        req.session.setAttribute(ru.lastochka.common.Metadata.Identity.AUTH_VERSION_ATTRIBUTE, 0L)
        val auth =
            org.springframework.security.authentication.UsernamePasswordAuthenticationToken
                .authenticated(a.email, null, emptyList())
        assertThrows(IllegalStateException::class.java) {
            authService.change(
                ChangePasswordRequest(original, permanent, permanent),
                req,
                org.springframework.mock.web.MockHttpServletResponse(),
                auth,
            )
        }
        assertEquals(1L, storage.find(a.id)!!.authVersion)
        assertEquals(a.id, accounts.password(a.login!!, permanent).id)
        assertThrows(org.springframework.web.server.ResponseStatusException::class.java) {
            accounts.password(a.login!!, original)
        }
    }
}
