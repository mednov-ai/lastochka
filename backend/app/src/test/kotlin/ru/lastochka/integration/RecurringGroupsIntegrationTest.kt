package ru.lastochka.integration

import java.time.*
import java.time.temporal.TemporalAdjusters
import java.util.UUID
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.web.server.ResponseStatusException
import org.testcontainers.postgresql.PostgreSQLContainer
import ru.lastochka.identity.service.AccountService
import ru.lastochka.scheduling.dto.*
import ru.lastochka.scheduling.service.*

@ActiveProfiles("test")
@org.springframework.context.annotation.Import(RecurringTestClockConfiguration::class)
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["lastochka.workers.enabled=false"],
)
class RecurringGroupsIntegrationTest {
    companion object {
        private val counter = AtomicLong(100)
        private val db = PostgreSQLContainer("postgres:17.6-alpine").apply { start() }

        init {
            Flyway.configure()
                .dataSource(db.jdbcUrl, db.username, db.password)
                .locations("classpath:db/migration")
                .target("14")
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

        @JvmStatic @AfterAll fun stop() = db.stop()
    }

    @Autowired lateinit var service: RecurrenceService
    @Autowired lateinit var sessions: SchedulingService
    @Autowired lateinit var editor: SessionEditorService
    @Autowired lateinit var enquiries: ru.lastochka.enquiries.service.EnquiryService
    @Autowired lateinit var jdbc: org.springframework.jdbc.core.simple.JdbcClient
    @org.springframework.boot.test.web.server.LocalServerPort var port: Int = 0
    @Autowired lateinit var accounts: AccountService

    @AfterEach
    fun resetTime() {
        RecurringTestClockConfiguration.now.set(null)
    }

    fun key() = UUID.randomUUID().toString()

    fun actor() =
        accounts.createAdmin("series-${key().take(8)}", "Проверка серий", "Fixture-pass-123").id

    fun rule(): SeriesRule {
        val start =
            LocalDate.now(ZoneId.of("Europe/Moscow"))
                .plusDays(counter.getAndAdd(40))
                .with(TemporalAdjusters.nextOrSame(DayOfWeek.MONDAY))
        return SeriesRule(
            start,
            start.plusDays(25),
            listOf(1, 3, 5),
            LocalTime.of(18, 0),
            50,
            "Ласточки",
            8,
            7,
            9,
        )
    }

    fun group(a: UUID) =
        service.saveGroup(
            a,
            null,
            key(),
            ScheduleGroupUpdate(0, ScheduleGroupInput("Ласточки", 8, 7, 9)),
        )

    fun draft(a: UUID): SessionSeriesView {
        val g = group(a)
        return service.save(a, null, key(), SeriesDraftInput(g.id, rule = rule()))
    }

    fun plan(s: SessionSeriesView) =
        service.preview(
            s.id,
            s.draft!!.copy(expectedVersion = s.version, expectedDraftVersion = s.draftVersion),
        )

    fun publish(a: UUID, s: SessionSeriesView) =
        service.publish(a, s.id, key(), SeriesCommand(s.version, s.draftVersion, plan(s).digest))

    fun values(s: SessionSeriesView): List<SessionView> {
        val rule = s.rule!!
        val from = rule.startDate.atStartOfDay(ZoneId.of("Europe/Moscow")).toInstant()
        val to = rule.endDate.plusDays(1).atStartOfDay(ZoneId.of("Europe/Moscow")).toInstant()
        return sessions.list(from, to, 0, 100, true).items
    }

    fun input(s: SessionView) =
        SessionInput(s.title, s.format, s.startsAt, s.endsAt, s.capacity, s.ageFrom, s.ageTo, true)

    fun conflict(action: () -> Unit) =
        assertEquals(409, assertThrows<ResponseStatusException> { action() }.statusCode.value())

    @Test
    fun `individual correction across start changes public selection only after publication`() {
        val a = actor()
        val published = publish(a, draft(a))
        val before = values(published)
        val first = before.first()
        RecurringTestClockConfiguration.now.set(first.startsAt.minusSeconds(60))
        val saved =
            editor.save(
                a,
                first.id,
                key(),
                SaveSessionDraft(
                    first.version,
                    null,
                    input(first).copy(title = "Исправленное занятие"),
                ),
            )
        RecurringTestClockConfiguration.now.set(first.startsAt)
        conflict {
            enquiries.submit(
                UUID.randomUUID(),
                ru.lastochka.enquiries.dto.EnquiryInput(
                    "Родитель",
                    "+79001234567",
                    desiredSessionId = first.id,
                    desiredSessionVersion = first.version,
                ),
            )
        }
        val corrected =
            editor
                .publish(a, first.id, key(), DraftCommand(first.version, saved.draft!!.version))
                .session
        assertEquals("Исправленное занятие", corrected.title)
        assertEquals(before.drop(1), values(service.read(published.id)).drop(1))
        val movedInput =
            input(corrected)
                .copy(
                    startsAt = first.startsAt.plusSeconds(3600),
                    endsAt = first.endsAt.plusSeconds(3600),
                )
        val movedDraft =
            editor.save(a, first.id, key(), SaveSessionDraft(corrected.version, null, movedInput))
        conflict {
            enquiries.submit(
                UUID.randomUUID(),
                ru.lastochka.enquiries.dto.EnquiryInput(
                    "Родитель",
                    "+79001234567",
                    desiredSessionId = first.id,
                    desiredSessionVersion = corrected.version,
                ),
            )
        }
        val moved =
            editor
                .publish(
                    a,
                    first.id,
                    key(),
                    DraftCommand(corrected.version, movedDraft.draft!!.version),
                )
                .session
        assertNotNull(
            enquiries.submit(
                UUID.randomUUID(),
                ru.lastochka.enquiries.dto.EnquiryInput(
                    "Родитель",
                    "+79001234567",
                    desiredSessionId = moved.id,
                    desiredSessionVersion = moved.version,
                ),
            )
        )
        val membership =
            service
                .calendar(first.startsAt.minusSeconds(60), moved.endsAt.plusSeconds(60))
                .memberships
                .single { it.sessionId == first.id }
        assertEquals(published.id, membership.seriesId)
        assertTrue(membership.exception)
    }

    @Test
    fun `started date of current week still checks overlap and leaves draft intact`() {
        val a = actor()
        val r = rule().copy(title = "Серия с занятым прошедшим временем")
        val start = r.startDate.atTime(r.startTime).atZone(ZoneId.of("Europe/Moscow")).toInstant()
        RecurringTestClockConfiguration.now.set(start.minusSeconds(60))
        val d = service.saveWithNewGroup(a, key(), NewGroupSeriesInput(r))
        val before = plan(d)
        assertTrue(before.canPublish)
        val samePlan = plan(d)
        assertEquals(before.digest, samePlan.digest)
        val other =
            sessions.create(a, key(), before.items.first().proposed!!.copy(title = "Занятое время"))
        sessions.applySessionAction(a, other.id, key(), SessionAction(other.version, "PUBLISH"))
        RecurringTestClockConfiguration.now.set(start)
        val atBoundary = plan(d)
        assertEquals(listOf("SCHEDULE_CONFLICT"), atBoundary.items.first().conflictCodes)
        assertFalse(atBoundary.canPublish)
        val publishKey = key()
        val ex =
            assertThrows<ResponseStatusException> {
                service.publish(
                    a,
                    d.id,
                    publishKey,
                    SeriesCommand(d.version, d.draftVersion, atBoundary.digest),
                )
            }
        assertEquals("SCHEDULE_CONFLICT", ex.reason)
        val retry =
            assertThrows<ResponseStatusException> {
                service.publish(
                    a,
                    d.id,
                    publishKey,
                    SeriesCommand(d.version, d.draftVersion, atBoundary.digest),
                )
            }
        assertEquals("SCHEDULE_CONFLICT", retry.reason)
        assertNotNull(service.read(d.id).draft)
        assertNull(service.read(d.id).rule)
        RecurringTestClockConfiguration.now.set(start.plusSeconds(240))
        val pastConflict = plan(d)
        assertEquals(listOf("SCHEDULE_CONFLICT"), pastConflict.items.first().conflictCodes)
        val pastRejection =
            assertThrows<ResponseStatusException> {
                service.publish(
                    a,
                    d.id,
                    key(),
                    SeriesCommand(d.version, d.draftVersion, pastConflict.digest),
                )
            }
        assertEquals("SCHEDULE_CONFLICT", pastRejection.reason)
        val from = r.startDate.atStartOfDay(ZoneId.of("Europe/Moscow")).toInstant()
        val to = r.endDate.plusDays(1).atStartOfDay(ZoneId.of("Europe/Moscow")).toInstant()
        assertTrue(sessions.list(from, to, 0, 100, true).items.none { it.title == r.title })
        assertEquals(12, plan(d).total)
    }

    @Test
    fun `current Moscow week allows creation from Monday midnight and keeps older Sunday blocked`() {
        val zone = ZoneId.of("Europe/Moscow")
        val now = LocalDateTime.of(2026, 10, 29, 17, 39).atZone(zone).toInstant()
        RecurringTestClockConfiguration.now.set(now)
        val base =
            SeriesRule(
                LocalDate.of(2026, 10, 25),
                LocalDate.of(2026, 11, 2),
                listOf(1, 2, 3, 4, 5, 6, 7),
                LocalTime.MIDNIGHT,
                60,
                "Проверка текущей недели",
                8,
            )
        val preview = service.previewNewGroup(NewGroupSeriesInput(base))
        assertEquals(listOf("SERIES_BEFORE_CURRENT_WEEK"), preview.items[0].conflictCodes)
        assertNull(preview.items[1].conflict)
        assertNull(preview.items[4].conflict)
        assertNull(preview.items.last().conflict)
        assertFalse(preview.canPublish)
        val lastSecond =
            base.copy(
                endDate = base.startDate,
                weekdays = listOf(7),
                startTime = LocalTime.of(23, 59, 59),
            )
        assertEquals(
            listOf("SERIES_BEFORE_CURRENT_WEEK"),
            service.previewNewGroup(NewGroupSeriesInput(lastSecond)).items.single().conflictCodes,
        )
        val a = actor()
        val d =
            service.saveWithNewGroup(
                a,
                key(),
                NewGroupSeriesInput(base.copy(startDate = base.startDate.plusDays(1))),
            )
        val ready = plan(d)
        assertTrue(ready.canPublish)
        val commandKey = key()
        val command = SeriesCommand(d.version, d.draftVersion, ready.digest)
        val published = service.publish(a, d.id, commandKey, command)
        assertEquals(published, service.publish(a, d.id, commandKey, command))
        val all = values(published)
        assertEquals(8, all.size)
        assertTrue(all.any { it.startsAt < now })
        val publicItems =
            sessions
                .list(now.minus(Duration.ofDays(8)), now.plus(Duration.ofDays(10)), 0, 100, false)
                .items
        assertTrue(publicItems.none { it.startsAt <= now })
        val first = all.first()
        val pastEnquiry =
            ru.lastochka.enquiries.dto.EnquiryInput(
                "Родитель",
                "+79001234567",
                desiredSessionId = first.id,
                desiredSessionVersion = first.version,
            )
        val enquiryFailure =
            assertThrows<ResponseStatusException> {
                enquiries.submit(UUID.randomUUID(), pastEnquiry)
            }
        assertEquals(409, enquiryFailure.statusCode.value())
        val saved =
            editor.save(
                a,
                first.id,
                key(),
                SaveSessionDraft(
                    first.version,
                    null,
                    input(first).copy(title = "Изменение истории"),
                ),
            )
        val updated =
            editor
                .publish(
                    a,
                    first.id,
                    key(),
                    DraftCommand(first.version, saved.draft!!.version),
                )
                .session
        assertEquals("Изменение истории", updated.title)
        assertEquals(first.id, updated.id)
        val membership =
            service
                .calendar(first.startsAt.minusSeconds(60), first.endsAt.plusSeconds(60))
                .memberships
                .first { it.sessionId == first.id }
        assertTrue(membership.exception)
        assertEquals(published.id, membership.seriesId)
        assertEquals(first.startsAt.atZone(zone).toLocalDate(), membership.originalDate)
        assertEquals(all.drop(1), values(service.read(published.id)).drop(1))
    }

    @Test
    fun `crossing into a new Moscow week rejects the whole saved plan`() {
        val zone = ZoneId.of("Europe/Moscow")
        val sunday = LocalDateTime.of(2026, 12, 13, 23, 59, 59).atZone(zone).toInstant()
        RecurringTestClockConfiguration.now.set(sunday)
        val a = actor()
        val r =
            SeriesRule(
                LocalDate.of(2026, 12, 7),
                LocalDate.of(2026, 12, 21),
                listOf(1),
                LocalTime.of(9, 0),
                60,
                "Переход недели",
                8,
            )
        val d = service.saveWithNewGroup(a, key(), NewGroupSeriesInput(r))
        val checked = plan(d)
        assertTrue(checked.canPublish)
        RecurringTestClockConfiguration.now.set(sunday.plusSeconds(1))
        val late = plan(d)
        assertEquals(listOf("SERIES_BEFORE_CURRENT_WEEK"), late.items.first().conflictCodes)
        val rejected =
            assertThrows<ResponseStatusException> {
                service.publish(
                    a,
                    d.id,
                    key(),
                    SeriesCommand(d.version, d.draftVersion, checked.digest),
                )
            }
        assertEquals("SERIES_BEFORE_CURRENT_WEEK", rejected.reason)
        assertNull(service.read(d.id).rule)
        assertNotNull(service.read(d.id).draft)
        val from = r.startDate.atStartOfDay(zone).toInstant()
        val to = r.endDate.plusDays(1).atStartOfDay(zone).toInstant()
        assertTrue(sessions.list(from, to, 0, 100, true).items.none { it.title == r.title })
    }

    @Test
    fun `new group preview is read only and save is atomic and replayable`() {
        val a = actor()
        val input = NewGroupSeriesInput(rule().copy(title = "Малышарики"))
        val groupsBefore = service.groups().items.size
        val seriesBefore = service.list().items.size
        assertEquals(12, service.previewNewGroup(input).creates)
        assertEquals(groupsBefore, service.groups().items.size)
        assertEquals(seriesBefore, service.list().items.size)

        val invalid = NewGroupSeriesInput(input.rule.copy(weekdays = emptyList()))
        assertThrows<RuntimeException> { service.saveWithNewGroup(a, key(), invalid) }
        assertEquals(groupsBefore, service.groups().items.size)
        assertEquals(seriesBefore, service.list().items.size)

        val command = key()
        val saved = service.saveWithNewGroup(a, command, input)
        assertEquals(saved, service.saveWithNewGroup(a, command, input))
        assertEquals(groupsBefore + 1, service.groups().items.size)
        assertEquals(seriesBefore + 1, service.list().items.size)
        assertEquals("Малышарики", service.group(saved.groupId).parameters.name)
        assertEquals(input.rule, saved.draft!!.rule)
        conflict { service.saveWithNewGroup(a, command, NewGroupSeriesInput(rule())) }
        val published = publish(a, saved)
        assertEquals(12, values(published).size)
    }

    @Test
    fun `rule produces twelve dates and rejects empty excessive and duplicate inputs`() {
        val r =
            rule().copy(startDate = LocalDate.of(2026, 11, 2), endDate = LocalDate.of(2026, 11, 27))
        assertEquals(12, service.expand(r).size)
        assertThrows<RuntimeException> { service.expand(r.copy(weekdays = emptyList())) }
        assertThrows<RuntimeException> { service.expand(r.copy(weekdays = listOf(1, 1))) }
        assertThrows<RuntimeException> {
            service.expand(r.copy(endDate = r.startDate.plusDays(366)))
        }
        assertThrows<RuntimeException> {
            service.expand(r.copy(endDate = r.startDate.plusDays(365), weekdays = (1..7).toList()))
        }
    }

    @Test
    fun `group rename does not rewrite published sessions and equal names remain distinct`() {
        val a = actor()
        val d = draft(a)
        val s = publish(a, d)
        val before = values(s)
        val g = service.group(s.groupId)
        service.saveGroup(
            a,
            g.id,
            key(),
            ScheduleGroupUpdate(g.version, g.parameters.copy(name = "Другое название")),
        )
        assertEquals(
            "Другое название",
            service.history(g.id, 0).items.first().groupParameters?.name,
        )
        assertEquals(before, values(s))
        assertNotEquals(g.id, group(a).id)
    }

    @Test
    fun `draft survives reading and preview creates no sessions or public version`() {
        val a = actor()
        val d = draft(a)
        val p = plan(d)
        assertEquals(12, p.creates)
        assertEquals(d, service.read(d.id))
        assertTrue(p.items.all { it.sessionId == null })
        val from = d.draft!!.rule.startDate.atStartOfDay(ZoneId.of("Europe/Moscow")).toInstant()
        assertTrue(sessions.calendar(from, from.plusSeconds(86400 * 7)).items.isEmpty())
        assertTrue(
            service.calendar(from, from.plusSeconds(86400 * 7)).drafts.any { it.seriesId == d.id }
        )
    }

    @Test
    fun `publication replay is atomic and mismatched key is rejected`() {
        val a = actor()
        val d = draft(a)
        val k = key()
        val command = SeriesCommand(d.version, d.draftVersion, plan(d).digest)
        val s = service.publish(a, d.id, k, command)
        assertEquals(s, service.publish(a, d.id, k, command))
        assertEquals(12, values(s).size)
        conflict { service.publish(a, d.id, k, command.copy(digest = "other")) }
        assertEquals(1, service.history(s.id, 0).items.count { it.action == "SERIES_PUBLISHED" })
    }

    @Test
    fun `one conflicting date leaves entire series unpublished`() {
        val a = actor()
        val d = draft(a)
        val p = plan(d)
        val slot = p.items.last().proposed!!
        val other = sessions.create(a, key(), slot)
        sessions.applySessionAction(a, other.id, key(), SessionAction(other.version, "PUBLISH"))
        assertFalse(plan(d).canPublish)
        conflict {
            service.publish(a, d.id, key(), SeriesCommand(d.version, d.draftVersion, p.digest))
        }
        assertNull(service.read(d.id).rule)
        assertNotNull(service.read(d.id).draft)
    }

    @Test
    fun `single legacy move preserves identity and becomes persistent exception`() {
        val a = actor()
        val s = publish(a, draft(a))
        val original = values(s).first()
        val moved =
            sessions.update(
                a,
                original.id,
                key(),
                SessionUpdate(
                    original.version,
                    input(original)
                        .copy(
                            startsAt = original.startsAt.plusSeconds(86400),
                            endsAt = original.endsAt.plusSeconds(86400),
                        ),
                ),
            )
        val current = service.read(s.id)
        val d =
            service.save(
                a,
                s.id,
                key(),
                SeriesDraftInput(
                    s.groupId,
                    current.version,
                    rule = s.rule!!.copy(startTime = LocalTime.of(19, 0)),
                ),
            )
        assertTrue(
            plan(d).items.any { it.sessionId == original.id && it.exception && it.action == "KEEP" }
        )
        publish(a, d)
        assertEquals(moved, sessions.find(original.id))
    }

    @Test
    fun `individual draft invalidates saved series plan and is not overwritten`() {
        val a = actor()
        val s = publish(a, draft(a))
        val item = values(s).first()
        val d =
            service.save(
                a,
                s.id,
                key(),
                SeriesDraftInput(
                    s.groupId,
                    s.version,
                    rule = s.rule!!.copy(startTime = LocalTime.of(19, 0)),
                ),
            )
        val p = plan(d)
        editor.save(
            a,
            item.id,
            key(),
            SaveSessionDraft(item.version, null, input(item).copy(title = "Отдельный черновик")),
        )
        conflict {
            service.publish(a, s.id, key(), SeriesCommand(d.version, d.draftVersion, p.digest))
        }
        val current = service.read(s.id)
        val latest =
            service.save(
                a,
                s.id,
                key(),
                current.draft!!.copy(
                    expectedVersion = current.version,
                    expectedDraftVersion = current.draftVersion,
                ),
            )
        assertFalse(plan(latest).canPublish)
        assertNotNull(editor.read(item.id).draft)
    }

    @Test
    fun `removing future Wednesdays cancels rows and retains Monday identities`() {
        val a = actor()
        val s = publish(a, draft(a))
        val before = values(s)
        val d =
            service.save(
                a,
                s.id,
                key(),
                SeriesDraftInput(
                    s.groupId,
                    s.version,
                    rule = s.rule!!.copy(weekdays = listOf(1, 5)),
                    reason = "Изменение расписания",
                ),
            )
        assertEquals(4, plan(d).cancellations)
        publish(a, d)
        for (v in before) assertEquals(
            if (v.startsAt.atZone(ZoneId.of("Europe/Moscow")).dayOfWeek == DayOfWeek.WEDNESDAY)
                "CANCELLED"
            else "OPEN",
            sessions.find(v.id).status,
        )
    }

    @Test
    fun `cancelled exception cannot regenerate and closed exception stays closed`() {
        val a = actor()
        val s = publish(a, draft(a))
        val list = values(s)
        sessions.applySessionAction(
            a,
            list[0].id,
            key(),
            SessionAction(list[0].version, "CANCEL", "Исключение"),
        )
        sessions.applySessionAction(a, list[1].id, key(), SessionAction(list[1].version, "CLOSE"))
        val current = service.read(s.id)
        val d =
            service.save(
                a,
                s.id,
                key(),
                SeriesDraftInput(
                    s.groupId,
                    current.version,
                    rule = s.rule!!.copy(endDate = s.rule!!.endDate.plusDays(7)),
                ),
            )
        publish(a, d)
        assertEquals("CANCELLED", sessions.find(list[0].id).status)
        assertEquals("CLOSED", sessions.find(list[1].id).status)
    }

    @Test
    fun `two publications cannot allocate same studio time`() {
        val a = actor()
        val first = draft(a)
        val second =
            service.save(a, null, key(), SeriesDraftInput(group(a).id, rule = first.draft!!.rule))
        val pool = Executors.newFixedThreadPool(2)
        try {
            val results =
                pool
                    .invokeAll(
                        listOf(first, second).map { s ->
                            Callable {
                                try {
                                    publish(a, s)
                                    true
                                } catch (_: ResponseStatusException) {
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
    }

    @Test
    fun `series cancellation and enquiry commit have one serialized outcome`() {
        val a = actor()
        val published = publish(a, draft(a))
        val item = values(published).first()
        val d =
            service.save(
                a,
                published.id,
                key(),
                SeriesDraftInput(
                    published.groupId,
                    published.version,
                    rule = published.rule!!,
                    reason = "Отмена расписания",
                    cancelFollowing = true,
                ),
            )
        val p = plan(d)
        val body =
            ru.lastochka.enquiries.dto.EnquiryInput(
                "Родитель",
                "+79001234567",
                "Ребёнок",
                8,
                desiredSessionId = item.id,
                desiredSessionVersion = item.version,
            )
        val pool = Executors.newFixedThreadPool(2)
        try {
            val request =
                pool.submit<ru.lastochka.enquiries.dto.EnquiryReceipt?> {
                    try {
                        enquiries.submit(UUID.randomUUID(), body)
                    } catch (e: ResponseStatusException) {
                        assertEquals(409, e.statusCode.value())
                        null
                    }
                }
            val publish = pool.submit {
                service.publish(a, d.id, key(), SeriesCommand(d.version, d.draftVersion, p.digest))
            }
            val receipt = request.get()
            publish.get()
            assertEquals("CANCELLED", sessions.find(item.id).status)
            if (receipt != null) {
                val snap =
                    jdbc
                        .sql(
                            "SELECT desired_session_snapshot FROM enrollment_requests WHERE public_number=:n"
                        )
                        .param("n", receipt.number)
                        .query(String::class.java)
                        .single()
                assertTrue(snap.contains(item.title))
            }
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `full plan of two hundred dates publishes with one operation`() {
        val a = actor()
        val first = LocalDate.now().plusYears(12)
        val r =
            rule()
                .copy(startDate = first, endDate = first.plusDays(199), weekdays = (1..7).toList())
        val d = service.save(a, null, key(), SeriesDraftInput(group(a).id, rule = r))
        val start = System.nanoTime()
        val p = plan(d)
        assertEquals(200, p.items.size)
        assertTrue(p.canPublish)
        val saved =
            service.publish(a, d.id, key(), SeriesCommand(d.version, d.draftVersion, p.digest))
        val count =
            jdbc
                .sql("SELECT count(*) FROM session_group_links WHERE series_id=:id")
                .param("id", saved.id)
                .query(Long::class.java)
                .single()
        assertEquals(200L, count)
        println("RECURRING_200_TOTAL_MS=" + (System.nanoTime() - start) / 1_000_000)
        assertEquals(200, service.history(saved.id, 0).items.first().affected)
    }

    @Test
    fun `history restore preserves membership and invalidates a series plan`() {
        val a = actor()
        val published = publish(a, draft(a))
        val item = values(published).first()
        val d =
            service.save(
                a,
                published.id,
                key(),
                SeriesDraftInput(
                    published.groupId,
                    published.version,
                    rule = published.rule!!.copy(startTime = LocalTime.of(19, 0)),
                ),
            )
        val p = plan(d)
        val revision = editor.history(item.id, 0).items.first { it.after != null }
        val restored =
            editor.restore(a, item.id, revision.id, key(), DraftCommand(item.version, null))
        assertNotNull(restored.draft)
        conflict {
            service.publish(a, d.id, key(), SeriesCommand(d.version, d.draftVersion, p.digest))
        }
        editor.discard(a, item.id, key(), DraftCommand(item.version, restored.draft!!.version))
        val from = item.startsAt.minusSeconds(3600)
        val context = service.calendar(from, from.plusSeconds(86400))
        assertTrue(
            context.memberships.any { it.sessionId == item.id && it.seriesId == published.id }
        )
    }

    @Test
    fun `new endpoints deny guests and missing csrf without disclosing groups`() {
        val client = java.net.http.HttpClient.newHttpClient()
        for (path in
            listOf("schedule-groups", "session-series", "session-series/" + UUID.randomUUID())) {
            val response =
                client.send(
                    java.net.http.HttpRequest.newBuilder(
                            java.net.URI("http://localhost:$port/lastochka/api/v1/admin/$path")
                        )
                        .GET()
                        .build(),
                    java.net.http.HttpResponse.BodyHandlers.ofString(),
                )
            assertTrue(response.statusCode() in listOf(401, 403))
            assertFalse(response.body().contains("parameters"))
        }
        val response =
            client.send(
                java.net.http.HttpRequest.newBuilder(
                        java.net.URI("http://localhost:$port/lastochka/api/v1/admin/session-series")
                    )
                    .header("Content-Type", "application/json")
                    .POST(java.net.http.HttpRequest.BodyPublishers.ofString("{}"))
                    .build(),
                java.net.http.HttpResponse.BodyHandlers.ofString(),
            )
        assertEquals(403, response.statusCode())
    }
}
