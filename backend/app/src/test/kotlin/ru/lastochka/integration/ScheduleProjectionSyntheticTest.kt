package ru.lastochka.integration

import java.net.CookieManager
import java.net.CookiePolicy
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import ru.lastochka.identity.service.AccountService
import ru.lastochka.scheduling.repo.PermanentScheduleRepository
import ru.lastochka.scheduling.service.PermanentScheduleProjectionService
import ru.lastochka.scheduling.service.PermanentOccurrenceService
import tools.jackson.databind.json.JsonMapper

/** Runs only against the task's isolated, synthetic database on its internal network. */
@EnabledIfEnvironmentVariable(named = "SCHEDULE_UX_SYNTHETIC_DATABASE_URL", matches = "jdbc:postgresql://schedule-ux-db:5432/scheduleux")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["lastochka.workers.enabled=false", "lastochka.schedule-extension.enabled=false"])
class ScheduleProjectionSyntheticTest {
    companion object {
        @JvmStatic @DynamicPropertySource
        fun database(registry: DynamicPropertyRegistry) {
            val url = System.getenv("SCHEDULE_UX_SYNTHETIC_DATABASE_URL")
            require(url == "jdbc:postgresql://schedule-ux-db:5432/scheduleux")
            registry.add("spring.datasource.url") { url }
            registry.add("spring.datasource.username") { "scheduleux" }
            registry.add("spring.datasource.password") { "scheduleux-synthetic" }
        }
    }
    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var tx: PlatformTransactionManager
    @Autowired lateinit var rules: PermanentScheduleRepository
    @Autowired lateinit var projection: PermanentScheduleProjectionService
    @Autowired lateinit var occurrence: PermanentOccurrenceService
    @Autowired lateinit var accounts: AccountService
    @Autowired lateinit var json: JsonMapper
    @LocalServerPort var port: Int = 0

    @Test
    fun `concurrent opening creates one future occurrence on the synthetic database`() {
        val group = UUID.randomUUID()
        val series = UUID.randomUUID()
        val direction = UUID.fromString("b8c0a000-0000-4000-8000-000000000003")
        val date = LocalDate.parse("2080-01-05")
        TransactionTemplate(tx).executeWithoutResult {
            jdbc.sql("INSERT INTO schedule_groups(id,parameters) VALUES(:id,CAST('{\"name\":\"Тест\"}' AS jsonb))").param("id", group).update()
            jdbc.sql("INSERT INTO session_series(id,group_id,age_direction_id) VALUES(:id,:groupId,:direction)")
                .param("id", series).param("groupId", group).param("direction", direction).update()
            rules.addPermanentSeries(series)
            rules.advanceRevision(series, 0)
            rules.addRevision(series, 1, date, null, 5, LocalTime.of(10, 0), 60, direction, "8–9 лет", 8, 8, 9, false)
            jdbc.sql("UPDATE concept_state SET mode='PERMANENT_SCHEDULE_V1' WHERE id=1").update()
        }
        val gate = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(2)
        val ids = try {
            (1..2).map { pool.submit<UUID> { gate.await(); occurrence.materialize(series, date, 1).id } }.also { gate.countDown() }.map { it.get() }
        } finally { pool.shutdownNow() }
        assertEquals(ids.first(), ids.last())
        assertEquals(1, jdbc.sql("SELECT count(*) FROM session_group_links WHERE series_id=:id AND original_date=:date")
            .param("id", series).param("date", date).query(Int::class.java).single())
    }

    @Test
    fun `historical plan is read only, absent publicly and protected by schedule permission`() {
        val group = UUID.randomUUID()
        val series = UUID.randomUUID()
        val direction = UUID.fromString("b8c0a000-0000-4000-8000-000000000003")
        val date = LocalDate.parse("2020-01-06")
        TransactionTemplate(tx).executeWithoutResult {
            jdbc.sql("INSERT INTO schedule_groups(id,parameters) VALUES(:id,CAST('{\"name\":\"Тест\"}' AS jsonb))").param("id", group).update()
            jdbc.sql("INSERT INTO session_series(id,group_id,age_direction_id) VALUES(:id,:groupId,:direction)")
                .param("id", series).param("groupId", group).param("direction", direction).update()
            rules.addPermanentSeries(series)
            rules.advanceRevision(series, 0)
            rules.addRevision(series, 1, date, null, 1, LocalTime.of(17, 0), 60, direction, "8–9 лет", 8, 8, 9, false)
        }
        val from = Instant.parse("2020-01-05T21:00:00Z")
        val to = Instant.parse("2020-01-12T21:00:00Z")
        fun count() = jdbc.sql("SELECT count(*) FROM studio_sessions").query(Int::class.java).single()
        val before = count()
        assertTrue(projection.page(from, to, 0, 20, false).items.isEmpty())
        assertEquals(series, projection.adminPage(from, to, 0, 20).items.single().calculated?.seriesId)
        assertEquals(before, count())
        val twoWeeks = Instant.parse("2020-01-19T21:00:00Z")
        val firstPage = projection.adminPage(from, twoWeeks, 0, 1)
        val secondPage = projection.adminPage(from, twoWeeks, 1, 1)
        assertEquals(2L, firstPage.total)
        assertEquals(firstPage.snapshot, secondPage.snapshot)
        jdbc.sql("UPDATE permanent_series_revisions SET title='Другое название' WHERE series_id=:id")
            .param("id", series).update()
        val changedPage = projection.adminPage(from, twoWeeks, 1, 1)
        assertEquals(firstPage.total, changedPage.total)
        assertNotEquals(firstPage.snapshot, changedPage.snapshot)
        assertEquals(before, count())

        val viewer = accounts.createAdmin("uxviewer${UUID.randomUUID().toString().take(8)}", "Сотрудник", "Test-pass-2026")
        val other = accounts.createAdmin("uxother${UUID.randomUUID().toString().take(8)}", "Сотрудник", "Test-pass-2026")
        for (account in listOf(viewer, other)) jdbc.sql("UPDATE accounts SET role='STAFF' WHERE id=:id").param("id", account.id).update()
        jdbc.sql("INSERT INTO staff_permissions(account_id,permission) VALUES(:id,'SCHEDULE_VIEW')").param("id", viewer.id).update()
        fun request(client: HttpClient, method: String, path: String, body: String = "", csrf: String? = null): HttpResponse<String> {
            val builder = HttpRequest.newBuilder(URI("http://127.0.0.1:$port/lastochka$path"))
            if (csrf != null) builder.header("X-CSRF-TOKEN", csrf)
            if (method != "GET") builder.header("Content-Type", "application/json")
            return client.send(builder.method(method, if (method == "GET") HttpRequest.BodyPublishers.noBody() else HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString())
        }
        fun token(client: HttpClient) = json.readTree(request(client, "GET", "/api/v1/auth/csrf").body()).path("token").asString()
        fun login(name: String): HttpClient {
            val client = HttpClient.newBuilder().cookieHandler(CookieManager(null, CookiePolicy.ACCEPT_ALL)).build()
            val response = request(client, "POST", "/api/v1/auth/password-stage", json.writeValueAsString(mapOf("login" to name, "password" to "Test-pass-2026")), token(client))
            assertEquals(200, response.statusCode(), response.body())
            return client
        }
        val path = "/api/v1/admin/permanent-schedule/projection?from=2020-01-05T21%3A00%3A00Z&to=2020-01-12T21%3A00%3A00Z"
        assertEquals(401, request(HttpClient.newHttpClient(), "GET", path).statusCode())
        val viewerClient = login(viewer.login!!)
        assertEquals(200, request(viewerClient, "GET", path).statusCode())
        assertEquals(403, request(login(other.login!!), "GET", path).statusCode())
        assertEquals(before, count())
    }
}
