package ru.lastochka.integration

import java.time.Instant
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
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
import ru.lastochka.scheduling.dto.*
import ru.lastochka.scheduling.service.*

@ActiveProfiles("test")
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["lastochka.workers.enabled=false"],
)
class ScheduleEditorIntegrationTest {
    companion object {
        private val nextDay = java.util.concurrent.atomic.AtomicLong(100)
        private val db = PostgreSQLContainer("postgres:17.6-alpine").apply { start() }

        init {
            Flyway.configure()
                .dataSource(db.jdbcUrl, db.username, db.password)
                .locations("classpath:db/migration")
                .target("12")
                .load()
                .migrate()
        }

        @JvmStatic
        @DynamicPropertySource
        fun properties(r: DynamicPropertyRegistry) {
            r.add("spring.datasource.url") { db.jdbcUrl }
            r.add("spring.datasource.username") { db.username }
            r.add("spring.datasource.password") { db.password }
        }

        @JvmStatic
        @AfterAll
        fun stop() {
            db.stop()
        }
    }

    @Autowired lateinit var accounts: AccountService
    @Autowired lateinit var sessions: SchedulingService
    @Autowired lateinit var editor: SessionEditorService
    @Autowired lateinit var enquiries: EnquiryService
    @Autowired lateinit var jdbc: JdbcClient

    fun actor() =
        accounts
            .createAdmin(
                "editor-" + UUID.randomUUID().toString().take(8),
                "Проверка редактора",
                "Fixture-pass-123",
            )
            .id

    fun key() = UUID.randomUUID().toString()

    fun input() =
        SessionInput(
            "Занятие",
            "GROUP",
            Instant.now().plusSeconds(86400 * nextDay.getAndIncrement()),
            Instant.now().plusSeconds(86400 * 30L),
            6,
        )

    fun create(actor: UUID): SessionView {
        val p = input()
        val v = sessions.create(actor, key(), p.copy(endsAt = p.startsAt.plusSeconds(3000)))
        return sessions.applySessionAction(actor, v.id, key(), SessionAction(v.version, "PUBLISH"))
    }

    fun params(v: SessionView) =
        SessionInput(v.title, v.format, v.startsAt, v.endsAt, v.capacity, 7, 10, true)

    fun conflict(block: () -> Unit) {
        assertEquals(409, assertThrows<ResponseStatusException> { block() }.statusCode.value())
    }

    private fun moveFixtureIntoPast(session: SessionView): SessionView {
        val past = session.startsAt.minusSeconds(86400L * 30000)
        jdbc
            .sql("UPDATE studio_sessions SET starts_at=:start, ends_at=:end WHERE id=:id")
            .param("start", past.atOffset(java.time.ZoneOffset.UTC))
            .param("end", past.plusSeconds(3000).atOffset(java.time.ZoneOffset.UTC))
            .param("id", session.id)
            .update()
        return sessions.find(session.id)
    }

    @Test
    fun `concurrent past draft publications allow only one update`() {
        val a = actor()
        val original = moveFixtureIntoPast(create(a))
        val saved =
            editor.save(
                a,
                original.id,
                key(),
                SaveSessionDraft(
                    original.version,
                    null,
                    params(original).copy(title = "Одно исправление"),
                ),
            )
        val command = DraftCommand(original.version, saved.draft!!.version)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val results =
                pool
                    .invokeAll(
                        (1..2).map {
                            Callable {
                                try {
                                    editor.publish(a, original.id, key(), command)
                                    200
                                } catch (e: ResponseStatusException) {
                                    e.statusCode.value()
                                }
                            }
                        }
                    )
                    .map { it.get() }
            assertEquals(listOf(200, 409), results.sorted())
        } finally {
            pool.shutdownNow()
        }
        assertEquals("Одно исправление", sessions.find(original.id).title)
        assertNull(editor.read(original.id).draft)
        assertEquals(
            1,
            editor.history(original.id, 0).items.count { it.action == "SESSION_DRAFT_PUBLISHED" },
        )
    }

    @Test
    fun `past session corrections preserve draft history and reject conflicts`() {
        val a = actor()
        val s = moveFixtureIntoPast(create(a))
        val saved =
            editor.save(
                a,
                s.id,
                key(),
                SaveSessionDraft(s.version, null, params(s).copy(title = "Исправлено")),
            )
        assertEquals(saved, editor.read(s.id))
        assertEquals(s, sessions.find(s.id))
        val command = DraftCommand(s.version, saved.draft!!.version)
        val publishKey = key()
        val result = editor.publish(a, s.id, publishKey, command)
        assertEquals(result, editor.publish(a, s.id, publishKey, command))
        assertEquals("Исправлено", result.session.title)
        assertEquals(s.id, result.session.id)
        assertNotNull(
            editor.history(s.id, 0).items.firstOrNull { it.action == "SESSION_DRAFT_PUBLISHED" }
        )

        val other = create(a)
        val blocked =
            editor.save(
                a,
                s.id,
                key(),
                SaveSessionDraft(
                    result.session.version,
                    null,
                    params(result.session).copy(startsAt = other.startsAt, endsAt = other.endsAt),
                ),
            )
        conflict {
            editor.publish(
                a,
                s.id,
                key(),
                DraftCommand(result.session.version, blocked.draft!!.version),
            )
        }
        assertEquals(result.session, sessions.find(s.id))
        assertNotNull(editor.read(s.id).draft)
        conflict {
            sessions.applySessionAction(
                a,
                s.id,
                key(),
                SessionAction(result.session.version, "CANCEL", "Причина"),
            )
        }
    }

    @Test
    fun `past closed and draft sessions can be corrected while cancelled remains read only`() {
        val a = actor()
        val open = create(a)
        val closed =
            sessions.applySessionAction(a, open.id, key(), SessionAction(open.version, "CLOSE"))
        val pastClosed = moveFixtureIntoPast(closed)
        val saved =
            editor.save(
                a,
                pastClosed.id,
                key(),
                SaveSessionDraft(
                    pastClosed.version,
                    null,
                    params(pastClosed).copy(title = "Исправлена закрытая"),
                ),
            )
        val result =
            editor.publish(
                a,
                pastClosed.id,
                key(),
                DraftCommand(pastClosed.version, saved.draft!!.version),
            )
        assertEquals("CLOSED", result.session.status)
        assertEquals("Исправлена закрытая", result.session.title)
        val revision = editor.history(pastClosed.id, 0).items.first { it.after != null }
        assertNotNull(
            editor
                .restore(
                    a,
                    pastClosed.id,
                    revision.id,
                    key(),
                    DraftCommand(result.session.version, null),
                )
                .draft
        )

        val newInput = input().let { it.copy(endsAt = it.startsAt.plusSeconds(3000)) }
        val draft = moveFixtureIntoPast(sessions.create(a, key(), newInput))
        val changed =
            sessions.update(
                a,
                draft.id,
                key(),
                SessionUpdate(draft.version, params(draft).copy(title = "Исправлен черновик")),
            )
        assertEquals(
            "OPEN",
            sessions
                .applySessionAction(a, changed.id, key(), SessionAction(changed.version, "PUBLISH"))
                .status,
        )

        val toCancel = create(a)
        val cancelled =
            sessions.applySessionAction(
                a,
                toCancel.id,
                key(),
                SessionAction(toCancel.version, "CANCEL", "Причина"),
            )
        assertEquals("CANCELLED", editor.read(cancelled.id).session.status)
        conflict {
            editor.save(
                a,
                cancelled.id,
                key(),
                SaveSessionDraft(cancelled.version, null, params(cancelled)),
            )
        }
        conflict {
            sessions.update(
                a,
                cancelled.id,
                key(),
                SessionUpdate(cancelled.version, params(cancelled)),
            )
        }
        val cancelledRevision = editor.history(cancelled.id, 0).items.first { it.after != null }
        conflict {
            editor.restore(
                a,
                cancelled.id,
                cancelledRevision.id,
                key(),
                DraftCommand(cancelled.version, null),
            )
        }
    }

    @Test
    fun `past correction does not rewrite an existing enquiry snapshot`() {
        val a = actor()
        val original = create(a)
        val request =
            enquiries.submit(
                UUID.randomUUID(),
                EnquiryInput(
                    "Родитель",
                    "+79001234567",
                    desiredSessionId = original.id,
                    desiredSessionVersion = original.version,
                ),
            )
        fun snapshot(): String =
            jdbc
                .sql(
                    "SELECT desired_session_snapshot FROM enrollment_requests WHERE public_number=:n"
                )
                .param("n", request.number)
                .query(String::class.java)
                .single()
        val before = snapshot()
        val past = moveFixtureIntoPast(original)
        val saved =
            editor.save(
                a,
                past.id,
                key(),
                SaveSessionDraft(
                    past.version,
                    null,
                    params(past).copy(title = "Исправленное название"),
                ),
            )
        editor.publish(a, past.id, key(), DraftCommand(past.version, saved.draft!!.version))
        assertEquals(before, snapshot())
        assertFalse(snapshot().contains("Исправленное название"))
    }

    @Test
    fun `draft does not change public revision and survives reading with replay`() {
        val a = actor()
        val s = create(a)
        val k = key()
        val request = SaveSessionDraft(s.version, null, params(s).copy(title = "Новый заголовок"))
        val saved = editor.save(a, s.id, k, request)
        assertEquals(saved, editor.save(a, s.id, k, request))
        assertEquals(saved, editor.read(s.id))
        assertEquals(s, sessions.find(s.id))
        assertNotNull(saved.draft)
        val out = editor.publish(a, s.id, key(), DraftCommand(s.version, saved.draft!!.version))
        assertEquals("Новый заголовок", out.session.title)
        assertEquals(7, out.session.ageFrom)
        assertNull(out.draft)
    }

    @Test
    fun `legacy update preserves age and makes saved draft stale`() {
        val a = actor()
        val s = create(a)
        val aged = sessions.update(a, s.id, key(), SessionUpdate(s.version, params(s)))
        val d =
            editor.save(a, s.id, key(), SaveSessionDraft(aged.version, null, params(aged))).draft!!
        val updated =
            sessions.update(
                a,
                s.id,
                key(),
                SessionUpdate(
                    aged.version,
                    params(aged)
                        .copy(
                            title = "Обновлено прежним клиентом",
                            ageFrom = null,
                            ageTo = null,
                            replaceAgeRange = false,
                        ),
                ),
            )
        assertEquals(7, updated.ageFrom)
        conflict { editor.publish(a, s.id, key(), DraftCommand(updated.version, d.version)) }
        val cleared =
            sessions.update(
                a,
                s.id,
                key(),
                SessionUpdate(
                    updated.version,
                    params(updated).copy(ageFrom = null, ageTo = null, replaceAgeRange = true),
                ),
            )
        assertNull(cleared.ageFrom)
    }

    @Test
    fun `concurrent draft saves cannot overwrite and recreated draft has new version`() {
        val a = actor()
        val s = create(a)
        val d = editor.save(a, s.id, key(), SaveSessionDraft(s.version, null, params(s))).draft!!
        val pool = Executors.newFixedThreadPool(2)
        try {
            val results =
                pool
                    .invokeAll(
                        (1..2).map {
                            Callable {
                                try {
                                    editor.save(
                                        a,
                                        s.id,
                                        key(),
                                        SaveSessionDraft(s.version, d.version, params(s)),
                                    )
                                    true
                                } catch (e: ResponseStatusException) {
                                    false
                                }
                            }
                        }
                    )
                    .map { it.get() }
            assertEquals(1, results.count { it })
        } finally {
            pool.shutdownNow()
        }
        val latest = editor.read(s.id).draft!!
        editor.discard(a, s.id, key(), DraftCommand(s.version, latest.version))
        val recreated =
            editor.save(a, s.id, key(), SaveSessionDraft(s.version, null, params(s))).draft!!
        assertTrue(recreated.version > latest.version)
    }

    @Test
    fun `closed status is preserved and cancelled publication fails`() {
        val a = actor()
        val s = create(a)
        val closed = sessions.applySessionAction(a, s.id, key(), SessionAction(s.version, "CLOSE"))
        val d =
            editor
                .save(a, s.id, key(), SaveSessionDraft(closed.version, null, params(closed)))
                .draft!!
        val published =
            editor.publish(a, s.id, key(), DraftCommand(closed.version, d.version)).session
        assertEquals("CLOSED", published.status)
        val next =
            editor
                .save(a, s.id, key(), SaveSessionDraft(published.version, null, params(published)))
                .draft!!
        val cancelled =
            sessions.applySessionAction(
                a,
                s.id,
                key(),
                SessionAction(published.version, "CANCEL", "Проверка"),
            )
        conflict { editor.publish(a, s.id, key(), DraftCommand(cancelled.version, next.version)) }
    }

    @Test
    fun `history restoration creates draft and cannot access another aggregate`() {
        val a = actor()
        val s = create(a)
        val other = create(a)
        val old = editor.history(s.id, 0).items.first { it.after != null }
        val saved = editor.restore(a, s.id, old.id, key(), DraftCommand(s.version, null))
        assertNotNull(saved.draft)
        assertEquals(s, sessions.find(s.id))
        assertEquals(
            404,
            assertThrows<ResponseStatusException> {
                    editor.restore(a, other.id, old.id, key(), DraftCommand(other.version, null))
                }
                .statusCode
                .value(),
        )
    }

    @Test
    fun `enquiry uses public snapshot while draft exists and cancelled selection is conflict`() {
        val a = actor()
        val s = create(a)
        editor.save(
            a,
            s.id,
            key(),
            SaveSessionDraft(s.version, null, params(s).copy(title = "Не опубликовано")),
        )
        val body =
            EnquiryInput(
                "Родитель",
                "+79001234567",
                "Ребёнок",
                6,
                desiredSessionId = s.id,
                desiredSessionVersion = s.version,
            )
        val r = enquiries.submit(UUID.randomUUID(), body)
        val snapshot =
            jdbc
                .sql(
                    "SELECT desired_session_snapshot FROM enrollment_requests WHERE public_number=:n"
                )
                .param("n", r.number)
                .query(String::class.java)
                .single()
        assertFalse(snapshot.contains("Не опубликовано"))
        sessions.applySessionAction(a, s.id, key(), SessionAction(s.version, "CANCEL", "Проверка"))
        conflict { enquiries.submit(UUID.randomUUID(), body) }
    }

    @Test
    fun `selectable list excludes closed and age validation rejects invalid pair`() {
        val a = actor()
        val s = create(a)
        sessions.applySessionAction(a, s.id, key(), SessionAction(s.version, "CLOSE"))
        assertEquals(1, sessions.list(s.startsAt, s.endsAt, 0, 100, false).total)
        assertEquals(0, sessions.list(s.startsAt, s.endsAt, 0, 100, false, true).total)
        assertThrows<ru.lastochka.common.error.FieldValidationException> {
            sessions.create(a, key(), params(s).copy(ageTo = null))
        }
    }

    @org.springframework.boot.test.web.server.LocalServerPort var port: Int = 0

    @Test
    fun `all draft and history routes reject guests and unsafe commands`() {
        val a = actor()
        val s = create(a)
        val c = java.net.http.HttpClient.newHttpClient()
        for (path in listOf("/draft", "/history")) {
            val r =
                c.send(
                    java.net.http.HttpRequest.newBuilder(
                            java.net.URI(
                                "http://localhost:$port/lastochka/api/v1/admin/sessions/${s.id}$path"
                            )
                        )
                        .GET()
                        .build(),
                    java.net.http.HttpResponse.BodyHandlers.ofString(),
                )
            assertTrue(r.statusCode() in listOf(401, 403))
            assertFalse(r.body().contains(s.title))
        }
        for ((method, path) in
            listOf(
                "PUT" to "/draft",
                "DELETE" to "/draft",
                "POST" to "/draft/publish",
                "POST" to "/history/1/restore-draft",
            )) {
            val r =
                c.send(
                    java.net.http.HttpRequest.newBuilder(
                            java.net.URI(
                                "http://localhost:$port/lastochka/api/v1/admin/sessions/${s.id}$path"
                            )
                        )
                        .header("Content-Type", "application/json")
                        .method(method, java.net.http.HttpRequest.BodyPublishers.ofString("{}"))
                        .build(),
                    java.net.http.HttpResponse.BodyHandlers.ofString(),
                )
            assertTrue(r.statusCode() in listOf(401, 403))
        }
        assertNull(editor.read(s.id).draft)
    }

    @Test
    fun `draft publications serialize competing resource allocation atomically`() {
        val a = actor()
        val one = create(a)
        val two = create(a)
        val target = one.startsAt.plusSeconds(86400 * 1000L)
        fun draft(s: SessionView) =
            editor
                .save(
                    a,
                    s.id,
                    key(),
                    SaveSessionDraft(
                        s.version,
                        null,
                        params(s).copy(startsAt = target, endsAt = target.plusSeconds(3000)),
                    ),
                )
                .draft!!
        val d1 = draft(one)
        val d2 = draft(two)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val results =
                pool
                    .invokeAll(
                        listOf(one to d1, two to d2).map { (s, d) ->
                            Callable {
                                try {
                                    editor.publish(
                                        a,
                                        s.id,
                                        key(),
                                        DraftCommand(s.version, d.version),
                                    )
                                    true
                                } catch (e: ResponseStatusException) {
                                    false
                                }
                            }
                        }
                    )
                    .map { it.get() }
            assertEquals(1, results.count { it })
            assertEquals(1, listOf(one, two).count { sessions.find(it.id).startsAt == target })
            val failed = listOf(one, two).first { sessions.find(it.id).startsAt != target }
            assertNotNull(editor.read(failed.id).draft)
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `enquiry racing publication sees exactly a committed public revision`() {
        val a = actor()
        val s = create(a)
        val draft =
            editor
                .save(
                    a,
                    s.id,
                    key(),
                    SaveSessionDraft(
                        s.version,
                        null,
                        params(s).copy(title = "Новое опубликованное"),
                    ),
                )
                .draft!!
        val body =
            EnquiryInput(
                "Родитель",
                "+79001234567",
                "Ребёнок",
                6,
                desiredSessionId = s.id,
                desiredSessionVersion = s.version,
            )
        val pool = Executors.newFixedThreadPool(2)
        try {
            val enquiry =
                pool.submit<ru.lastochka.enquiries.dto.EnquiryReceipt?> {
                    try {
                        enquiries.submit(UUID.randomUUID(), body)
                    } catch (e: ResponseStatusException) {
                        assertEquals(409, e.statusCode.value())
                        null
                    }
                }
            val publish = pool.submit {
                editor.publish(a, s.id, key(), DraftCommand(s.version, draft.version))
            }
            val result = enquiry.get()
            publish.get()
            if (result != null) {
                val snap =
                    jdbc
                        .sql(
                            "SELECT desired_session_snapshot FROM enrollment_requests WHERE public_number=:n"
                        )
                        .param("n", result.number)
                        .query(String::class.java)
                        .single()
                assertFalse(snap.contains("Новое опубликованное"))
            }
            conflict { enquiries.submit(UUID.randomUUID(), body) }
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `selectable pagination counts all eligible rows after closed rows`() {
        val a = actor()
        val start = Instant.now().plusSeconds(86400 * 2000L)
        for (i in 0..11) {
            val p =
                SessionInput(
                    "Страница $i",
                    "GROUP",
                    start.plusSeconds(i * 3600L),
                    start.plusSeconds(i * 3600L + 3000),
                    6,
                )
            val d = sessions.create(a, key(), p)
            val s = sessions.applySessionAction(a, d.id, key(), SessionAction(d.version, "PUBLISH"))
            if (i < 6)
                sessions.applySessionAction(a, s.id, key(), SessionAction(s.version, "CLOSE"))
        }
        val first = sessions.list(start, start.plusSeconds(86400), 0, 3, false, true)
        val next = sessions.list(start, start.plusSeconds(86400), 1, 3, false, true)
        assertEquals(6, first.total)
        assertEquals(3, first.items.size)
        assertEquals(3, next.items.size)
        assertTrue(first.items.none { f -> next.items.any { it.id == f.id } })
    }
}
