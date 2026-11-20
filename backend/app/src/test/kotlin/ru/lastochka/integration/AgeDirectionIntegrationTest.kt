package ru.lastochka.integration

import java.net.CookieManager
import java.net.CookiePolicy
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
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
import org.springframework.web.server.ResponseStatusException
import org.testcontainers.postgresql.PostgreSQLContainer
import ru.lastochka.common.error.FieldValidationException
import ru.lastochka.identity.security.StaffPermissionPolicy
import ru.lastochka.identity.service.AccountService
import ru.lastochka.scheduling.dto.AgeDirectionUpdate
import ru.lastochka.scheduling.service.AgeDirectionService
import tools.jackson.databind.json.JsonMapper

@ActiveProfiles("test")
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["lastochka.workers.enabled=false"],
)
class AgeDirectionIntegrationTest {
    companion object {
        private val db = PostgreSQLContainer("postgres:17.6-alpine").apply {
            withCreateContainerCmdModifier { command ->
                command.hostConfig!!.withMemory(268435456L).withNanoCPUs(1000000000L)
            }
            start()
        }

        @JvmStatic
        @DynamicPropertySource
        fun database(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url") { db.jdbcUrl }
            registry.add("spring.datasource.username") { db.username }
            registry.add("spring.datasource.password") { db.password }
        }

        @JvmStatic @AfterAll fun stop() = db.stop()
    }

    @Autowired lateinit var service: AgeDirectionService
    @Autowired lateinit var accounts: AccountService
    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var weekly: ru.lastochka.scheduling.service.WeeklyScheduleService
    @Autowired lateinit var json: JsonMapper
    @LocalServerPort var port: Int = 0

    @Test
    fun `dictionary is versioned and archived without touching existing snapshots`() {
        val actor = accounts.createAdmin("age-check", "Администратор", "Test-pass-2026").id
        val original = service.active().items
        assertEquals(5, original.count { it.id.toString().startsWith("b8c0a000-") })
        assertEquals(null, original.single { it.ageFrom == 14 }.ageTo)

        val request = UUID.randomUUID()
        jdbc.sql("INSERT INTO enrollment_requests(id,parent_name,phone,desired_session_snapshot) VALUES (:id,'Тест','79990000000','исходный снимок')")
            .param("id", request).update()

        val input = AgeDirectionUpdate("Новая группа", "Описание", 8, 9, false, true, 60, 0)
        val key = UUID.randomUUID().toString()
        val created = service.save(actor, null, key, input)
        assertEquals(created, service.save(actor, null, key, input))
        val changed =
            service.save(
                actor,
                created.id,
                UUID.randomUUID().toString(),
                input.copy(title = "Архив", active = false, expectedVersion = created.version),
            )
        assertTrue(changed.version > created.version)
        assertFalse(service.active().items.any { it.id == created.id })
        assertTrue(service.all().items.any { it.id == created.id && !it.active })
        assertThrows(ResponseStatusException::class.java) {
            service.save(
                actor,
                created.id,
                UUID.randomUUID().toString(),
                input.copy(expectedVersion = created.version),
            )
        }
        assertThrows(FieldValidationException::class.java) {
            service.save(
                actor,
                created.id,
                UUID.randomUUID().toString(),
                input.copy(ageFrom = 10, ageTo = 9, expectedVersion = changed.version),
            )
        }
        val restored =
            service.save(
                actor,
                created.id,
                UUID.randomUUID().toString(),
                input.copy(expectedVersion = changed.version),
            )
        assertTrue(restored.active)
        weekly.save(actor, UUID.randomUUID().toString(), null,
            ru.lastochka.scheduling.dto.WeeklySlotInput(0,created.id,2,600,45))
        assertThrows(org.springframework.dao.DataIntegrityViolationException::class.java) {
            jdbc.sql("DELETE FROM age_directions WHERE id=:id").param("id", created.id).update()
        }
        val gate = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val results =
                (1..2).map { number ->
                    pool.submit<Boolean> {
                        gate.await()
                        try {
                            service.save(
                                actor,
                                created.id,
                                UUID.randomUUID().toString(),
                                input.copy(
                                    title = "Правка $number",
                                    expectedVersion = restored.version,
                                ),
                            )
                            true
                        } catch (_: ResponseStatusException) {
                            false
                        }
                    }
                }
            gate.countDown()
            assertEquals(listOf(false, true), results.map { it.get() }.sorted())
        } finally {
            pool.shutdownNow()
        }
        assertEquals(
            "исходный снимок",
            jdbc
                .sql("SELECT desired_session_snapshot FROM enrollment_requests WHERE id=:id")
                .param("id", request)
                .query(String::class.java)
                .single(),
        )
    }

    @Test
    fun `staff policy does not grant dictionary administration`() {
        assertNull(StaffPermissionPolicy.required("GET", "/api/v1/admin/age-directions"))
        assertNull(StaffPermissionPolicy.required("POST", "/api/v1/admin/age-directions"))
        assertNull(StaffPermissionPolicy.required("PUT", "/api/v1/admin/age-directions/123"))
    }

    @Test
    fun `HTTP restricts dictionary writes to admin and exposes active choices publicly`() {
        val admin = accounts.createAdmin("age-http-admin", "Администратор", "Test-pass-2026")
        val editor = accounts.createAdmin("age-http-editor", "Сотрудник", "Test-pass-2026")
        val other = accounts.createAdmin("age-http-other", "Сотрудник", "Test-pass-2026")
        for (account in listOf(editor, other)) jdbc
            .sql("UPDATE accounts SET role='STAFF' WHERE id=:id")
            .param("id", account.id)
            .update()
        jdbc
            .sql(
                "INSERT INTO staff_permissions(account_id,permission) VALUES (:id,'SCHEDULE_EDIT')"
            )
            .param("id", editor.id)
            .update()

        fun request(
            client: HttpClient,
            method: String,
            path: String,
            body: String = "",
            csrf: String? = null,
        ): HttpResponse<String> {
            val builder = HttpRequest.newBuilder(URI("http://127.0.0.1:$port/lastochka$path"))
            if (csrf != null) builder.header("X-CSRF-TOKEN", csrf)
            if (method != "GET")
                builder
                    .header("Content-Type", "application/json")
                    .header("Idempotency-Key", UUID.randomUUID().toString())
            builder.method(
                method,
                if (method == "GET") HttpRequest.BodyPublishers.noBody()
                else HttpRequest.BodyPublishers.ofString(body),
            )
            return client.send(builder.build(), HttpResponse.BodyHandlers.ofString())
        }
        fun token(client: HttpClient) =
            json
                .readTree(request(client, "GET", "/api/v1/auth/csrf").body())
                .path("token")
                .asString()
        fun login(name: String): Pair<HttpClient, String> {
            val client =
                HttpClient.newBuilder()
                    .cookieHandler(CookieManager(null, CookiePolicy.ACCEPT_ALL))
                    .build()
            val response =
                request(
                    client,
                    "POST",
                    "/api/v1/auth/password-stage",
                    json.writeValueAsString(mapOf("login" to name, "password" to "Test-pass-2026")),
                    token(client),
                )
            assertEquals(200, response.statusCode(), response.body())
            return client to token(client)
        }
        val (adminClient, adminToken) = login(admin.login!!)
        val (editorClient, editorToken) = login(editor.login!!)
        val (otherClient, otherToken) = login(other.login!!)
        val schedulePath = "/api/v1/admin/schedule/weekly"
        val scheduleBody = ru.lastochka.scheduling.dto.WeeklySlotInput(0,
            UUID.fromString("b8c0a000-0000-4000-8000-000000000003"),3,180,45)
        assertEquals(200, request(adminClient, "POST", schedulePath, json.writeValueAsString(scheduleBody), adminToken).statusCode())
        assertEquals(200, request(editorClient, "POST", schedulePath, json.writeValueAsString(scheduleBody.copy(startMinute=300)), editorToken).statusCode())
        assertEquals(403, request(otherClient, "POST", schedulePath, json.writeValueAsString(scheduleBody), otherToken).statusCode())
        val specification = request(adminClient, "GET", "/v3/api-docs")
        assertEquals(200, specification.statusCode())
        assertTrue(
            json.readTree(specification.body()).path("paths").has("/api/v1/public/age-directions")
        )
        System.getenv("LASTOCHKA_TEST_OPENAPI_PATH")?.let {
            java.nio.file.Files.writeString(java.nio.file.Path.of(it), specification.body())
        }
        val input = AgeDirectionUpdate("Направление HTTP", "Описание", 6, 7, false, true, 65, 0)
        val body = json.writeValueAsString(input)
        val path = "/api/v1/admin/age-directions"
        assertEquals(200, request(adminClient, "GET", path).statusCode())
        val created = request(adminClient, "POST", path, body, adminToken)
        assertEquals(200, created.statusCode(), created.body())
        val id = json.readTree(created.body()).path("id").asString()
        val missingVersion =
            json.writeValueAsString(
                mapOf(
                    "title" to "Без версии",
                    "description" to "",
                    "ageFrom" to 3,
                    "ageTo" to 5,
                    "ageOpenEnded" to false,
                    "active" to true,
                    "sortOrder" to 1,
                )
            )
        assertEquals(
            400,
            request(adminClient, "PUT", "$path/$id", missingVersion, adminToken).statusCode(),
        )
        assertEquals(405, request(adminClient, "DELETE", "$path/$id", "", adminToken).statusCode())
        for ((client, csrf) in listOf(editorClient to editorToken, otherClient to otherToken)) {
            assertEquals(403, request(client, "GET", path).statusCode())
            assertEquals(403, request(client, "POST", path, body, csrf).statusCode())
            assertEquals(403, request(client, "PUT", "$path/$id", body, csrf).statusCode())
            assertEquals(200, request(client, "GET", "/api/v1/public/age-directions").statusCode())
        }
        assertEquals(200, request(editorClient, "GET", schedulePath).statusCode())
        assertEquals(403, request(otherClient, "GET", schedulePath).statusCode())
    }
}
