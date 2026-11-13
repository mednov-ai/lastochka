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
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.springframework.web.server.ResponseStatusException
import org.testcontainers.postgresql.PostgreSQLContainer
import ru.lastochka.common.error.FieldValidationException
import ru.lastochka.identity.security.StaffPermissionPolicy
import ru.lastochka.identity.service.AccountService
import ru.lastochka.scheduling.dto.AgeDirectionUpdate
import ru.lastochka.scheduling.repo.PermanentScheduleRepository
import ru.lastochka.scheduling.service.AgeDirectionService
import ru.lastochka.scheduling.service.LegacyScheduleCompatibilityService
import ru.lastochka.scheduling.service.PermanentScheduleProjectionService
import ru.lastochka.scheduling.service.PermanentOccurrenceService
import ru.lastochka.enquiries.service.EnquiryService
import ru.lastochka.enquiries.dto.EnquiryInput
import ru.lastochka.enquiries.dto.EnquiryParticipantType
import ru.lastochka.scheduling.dto.ScheduleRuleReference
import ru.lastochka.scheduling.dto.SessionInput
import ru.lastochka.scheduling.dto.SessionAction
import ru.lastochka.scheduling.dto.SessionUpdate
import ru.lastochka.scheduling.dto.SeriesRule
import ru.lastochka.scheduling.dto.SeriesDraftInput
import ru.lastochka.scheduling.dto.PermanentPlanInput
import ru.lastochka.scheduling.dto.PermanentPlanPublish
import ru.lastochka.scheduling.dto.PermanentSlotInput
import ru.lastochka.scheduling.dto.PermanentRuleChange
import ru.lastochka.scheduling.dto.PermanentRuleChangePublish
import ru.lastochka.scheduling.dto.PermanentRuleStop
import ru.lastochka.scheduling.dto.PermanentStopPublish
import ru.lastochka.scheduling.service.SchedulingService
import ru.lastochka.scheduling.service.PermanentScheduleExtension
import ru.lastochka.scheduling.service.PermanentPlanService
import ru.lastochka.scheduling.service.RecurrenceService
import tools.jackson.databind.json.JsonMapper

@ActiveProfiles("test")
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["lastochka.workers.enabled=false", "lastochka.schedule-extension.enabled=false"],
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
    @Autowired lateinit var permanent: PermanentScheduleRepository
    @Autowired lateinit var projection: PermanentScheduleProjectionService
    @Autowired lateinit var legacySchedule: LegacyScheduleCompatibilityService
    @Autowired lateinit var occurrence: PermanentOccurrenceService
    @Autowired lateinit var scheduling: SchedulingService
    @Autowired lateinit var extension: PermanentScheduleExtension
    @Autowired lateinit var permanentPlans: PermanentPlanService
    @Autowired lateinit var legacyRecurrence: RecurrenceService
    @Autowired lateinit var enquiries: EnquiryService
    @Autowired lateinit var txManager: PlatformTransactionManager
    @Autowired lateinit var json: JsonMapper
    @LocalServerPort var port: Int = 0

    @Test
    fun `dictionary is versioned and archived without touching existing snapshots`() {
        val actor = accounts.createAdmin("age-check", "Администратор", "Test-pass-2026").id
        val original = service.active().items
        assertEquals(5, original.count { it.id.toString().startsWith("b8c0a000-") })
        assertEquals(null, original.single { it.ageFrom == 14 }.ageTo)

        val session = UUID.randomUUID()
        val request = UUID.randomUUID()
        jdbc
            .sql(
                "INSERT INTO studio_sessions(id,title,format,starts_at,ends_at,capacity,status,age_from,age_to) VALUES (:id,'Старое занятие','GROUP',now()+interval '30 days',now()+interval '30 days 1 hour',8,'OPEN',8,9)"
            )
            .param("id", session)
            .update()
        jdbc
            .sql(
                "INSERT INTO enrollment_requests(id,parent_name,phone,child_name,child_age,desired_session_id,desired_session_snapshot) VALUES (:id,'Тест','79990000000','Тест',8,:session,'исходный снимок')"
            )
            .param("id", request)
            .param("session", session)
            .update()

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
        val group = UUID.randomUUID()
        jdbc
            .sql("INSERT INTO schedule_groups(id,parameters) VALUES(:id,CAST('{}' AS jsonb))")
            .param("id", group)
            .update()
        jdbc
            .sql(
                "INSERT INTO session_series(id,group_id,age_direction_id) VALUES(:id,:groupId,:direction)"
            )
            .param("id", UUID.randomUUID())
            .param("groupId", group)
            .param("direction", created.id)
            .update()
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
        assertEquals(
            8,
            jdbc
                .sql("SELECT capacity FROM studio_sessions WHERE id=:id")
                .param("id", session)
                .query(Int::class.java)
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
    @Transactional
    fun `permanent rule revisions are separate from old finite series`() {
        val group = UUID.randomUUID()
        val series = UUID.randomUUID()
        val direction = UUID.fromString("b8c0a000-0000-4000-8000-000000000003")
        jdbc
            .sql("INSERT INTO schedule_groups(id,parameters) VALUES(:id,CAST('{}' AS jsonb))")
            .param("id", group)
            .update()
        jdbc
            .sql(
                "INSERT INTO session_series(id,group_id,age_direction_id) VALUES(:id,:groupId,:direction)"
            )
            .param("id", series)
            .param("groupId", group)
            .param("direction", direction)
            .update()
        assertEquals(1, permanent.addPermanentSeries(series))
        assertEquals(1, permanent.advanceRevision(series, 0))
        assertEquals(0, permanent.advanceRevision(series, 0))
        assertEquals(
            1,
            permanent.addRevision(
                series,
                1,
                LocalDate.parse("2030-01-01"),
                null,
                1,
                LocalTime.of(17, 0),
                60,
                direction,
                "8–9 лет",
                8,
                8,
                9,
                false,
            ),
        )
        val revision =
            permanent
                .revisionsIn(LocalDate.parse("2040-01-01"), LocalDate.parse("2040-01-08"))
                .single { it.seriesId == series }
        assertEquals(1L, revision.revision)
        assertEquals(LocalTime.of(17, 0), revision.startTime)
        assertEquals(direction, revision.directionId)
        assertNull(revision.effectiveUntil)
        assertEquals(1L, permanent.permanentRevision(series))
        val boundary = LocalDate.parse("2035-01-01")
        assertEquals(1, permanent.advanceRevision(series, 1))
        assertEquals(1, permanent.endCurrentAt(series, boundary))
        assertEquals(
            1,
            permanent.addRevision(
                series,
                2,
                boundary,
                null,
                1,
                LocalTime.of(18, 0),
                60,
                direction,
                "8–9 лет",
                8,
                8,
                9,
                false,
            ),
        )
        assertEquals(
            LocalTime.of(17, 0),
            permanent
                .revisionsIn(LocalDate.parse("2034-12-01"), LocalDate.parse("2034-12-08"))
                .single { it.seriesId == series }
                .startTime,
        )
        assertEquals(1, permanent.advanceRevision(series, 2))
        assertEquals(1, permanent.supersedeFuture(series, boundary))
        assertEquals(
            1,
            permanent.addRevision(
                series,
                3,
                boundary,
                null,
                1,
                LocalTime.of(19, 0),
                60,
                direction,
                "8–9 лет",
                8,
                8,
                9,
                false,
            ),
        )
        assertEquals(
            LocalTime.of(19, 0),
            permanent
                .revisionsIn(LocalDate.parse("2040-01-01"), LocalDate.parse("2040-01-08"))
                .single { it.seriesId == series }
                .startTime,
        )
        assertEquals(
            3,
            jdbc
                .sql("SELECT count(*) FROM permanent_series_revisions WHERE series_id=:id")
                .param("id", series)
                .query(Int::class.java)
                .single(),
        )
    }

    @Test
    @Transactional
    fun `future reads calculate dates without writing and respect moved exceptions`() {
        val group = UUID.randomUUID()
        val series = UUID.randomUUID()
        val direction = UUID.fromString("b8c0a000-0000-4000-8000-000000000003")
        jdbc
            .sql(
                "INSERT INTO schedule_groups(id,parameters) VALUES(:id,CAST('{\"name\":\"Тест\"}' AS jsonb))"
            )
            .param("id", group)
            .update()
        jdbc
            .sql(
                "INSERT INTO session_series(id,group_id,age_direction_id) VALUES(:id,:groupId,:direction)"
            )
            .param("id", series)
            .param("groupId", group)
            .param("direction", direction)
            .update()
        permanent.addPermanentSeries(series)
        permanent.advanceRevision(series, 0)
        permanent.addRevision(
            series,
            1,
            LocalDate.parse("2030-01-01"),
            null,
            1,
            LocalTime.of(17, 0),
            60,
            direction,
            "8–9 лет",
            8,
            8,
            9,
            false,
        )
        val from = Instant.parse("2040-01-08T21:00:00Z")
        val to = Instant.parse("2040-01-15T21:00:00Z")
        fun count() =
            jdbc.sql("SELECT count(*) FROM studio_sessions").query(Int::class.java).single()
        val before = count()
        val projected = projection.page(from, to, 0, 20, false)
        assertEquals(before, count())
        assertEquals(1L, projected.total)
        assertEquals(ru.lastochka.scheduling.dto.ScheduleOccurrenceKind.CALCULATED, projected.items.single().kind)
        assertNull(projected.items.single().session)
        assertEquals(
            LocalDate.parse("2040-01-09"),
            projected.items.single().calculated?.originalDate,
        )
        val oldClient = assertThrows(ResponseStatusException::class.java) {
            legacySchedule.list(from, to, 0, 20, false)
        }
        assertEquals("SCHEDULE_UPDATE_REQUIRED", oldClient.reason)
        val moved = UUID.randomUUID()
        jdbc
            .sql(
                "INSERT INTO studio_sessions(id,title,format,starts_at,ends_at,capacity,status) VALUES(:id,'Перенос','GROUP','2040-01-10 17:00+03','2040-01-10 18:00+03',8,'OPEN')"
            )
            .param("id", moved)
            .update()
        jdbc
            .sql(
                "INSERT INTO session_group_links(session_id,group_id,series_id,original_date,is_exception) VALUES(:id,:groupId,:seriesId,'2040-01-09',true)"
            )
            .param("id", moved)
            .param("groupId", group)
            .param("seriesId", series)
            .update()
        val afterMove = projection.page(from, to, 0, 20, false)
        assertEquals(1L, afterMove.total)
        assertEquals(moved, afterMove.items.single().session?.id)
        assertNull(afterMove.items.single().calculated)
        assertEquals(moved, legacySchedule.list(from, to, 0, 20, false).items.single().id)
        assertEquals(before + 1, count())
    }

    @Test
    fun `concurrent materialization reuses one session and exceptions are not revived`() {
        val group = UUID.randomUUID()
        val series = UUID.randomUUID()
        val direction = UUID.fromString("b8c0a000-0000-4000-8000-000000000003")
        val date = LocalDate.parse("2080-01-01")
        val tx = TransactionTemplate(txManager)
        tx.executeWithoutResult {
            jdbc.sql("INSERT INTO schedule_groups(id,parameters) VALUES(:id,CAST('{\"name\":\"Тест\"}' AS jsonb))").param("id", group).update()
            jdbc.sql("INSERT INTO session_series(id,group_id,age_direction_id) VALUES(:id,:groupId,:direction)").param("id", series).param("groupId", group).param("direction", direction).update()
            permanent.addPermanentSeries(series)
            permanent.advanceRevision(series, 0)
            permanent.addRevision(series, 1, date, null, 1, LocalTime.of(17, 0), 60, direction, "8–9 лет", 8, 8, 9, false)
            jdbc.sql("UPDATE concept_state SET mode='PERMANENT_SCHEDULE_V1' WHERE id=1").update()
        }
        try {
            val client = HttpClient.newHttpClient()
            val window = "from=2079-12-31T21%3A00%3A00Z&to=2080-01-07T21%3A00%3A00Z"
            fun get(path: String) = client.send(HttpRequest.newBuilder(URI("http://127.0.0.1:$port/lastochka$path")).GET().build(), HttpResponse.BodyHandlers.ofString())
            val beforeRead = jdbc.sql("SELECT count(*) FROM studio_sessions").query(Int::class.java).single()
            val calculated = get("/api/v1/public/schedule?$window")
            assertEquals(200, calculated.statusCode(), calculated.body())
            val first = json.readTree(calculated.body()).path("items").get(0)
            assertEquals("CALCULATED", first.path("kind").asString())
            assertEquals(series.toString(), first.path("calculated").path("seriesId").asString())
            assertEquals(beforeRead, jdbc.sql("SELECT count(*) FROM studio_sessions").query(Int::class.java).single())
            val oldClient = get("/api/v1/sessions?$window")
            assertEquals(409, oldClient.statusCode())
            assertEquals("SCHEDULE_UPDATE_REQUIRED", json.readTree(oldClient.body()).path("code").asString())
            val gate = CountDownLatch(1)
            val pool = Executors.newFixedThreadPool(2)
            val results = try {
                val tasks = (1..2).map {
                    pool.submit<UUID> {
                        gate.await()
                        occurrence.materialize(series, date, 1).id
                    }
                }
                gate.countDown()
                tasks.map { it.get() }
            } finally {
                pool.shutdownNow()
            }
            assertEquals(results.first(), results.last())
            val realized = get("/api/v1/public/schedule?$window")
            assertEquals("SESSION", json.readTree(realized.body()).path("items").get(0).path("kind").asString())
            assertEquals(series.toString(), json.readTree(realized.body()).path("items").get(0).path("origin").path("seriesId").asString())
            assertEquals(1, jdbc.sql("SELECT count(*) FROM session_group_links WHERE series_id=:id AND original_date=:date").param("id", series).param("date", date).query(Int::class.java).single())
            assertThrows(ResponseStatusException::class.java) { occurrence.materialize(series, date, 0) }
            val input = EnquiryInput("Проверка", "+79001234567", contractVersion = 2,
                participantType = EnquiryParticipantType.SELF, participantAge = 34,
                calculatedSession = ScheduleRuleReference(1, series, date, 1))
            val keys = listOf(UUID.randomUUID(), UUID.randomUUID())
            val enquiryPool = Executors.newFixedThreadPool(2)
            val receipts = try {
                keys.map { key -> enquiryPool.submit<ru.lastochka.enquiries.dto.EnquiryReceipt> { enquiries.submit(key, input) } }.map { it.get() }
            } finally {
                enquiryPool.shutdownNow()
            }
            assertNotEquals(receipts.first().number, receipts.last().number)
            assertEquals(receipts.first(), enquiries.submit(keys.first(), input))
            assertEquals(2, jdbc.sql("SELECT count(*) FROM enrollment_requests WHERE desired_session_id=:id").param("id", results.first()).query(Int::class.java).single())
            assertThrows(ResponseStatusException::class.java) {
                enquiries.submit(UUID.randomUUID(), input.copy(calculatedSession = input.calculatedSession!!.copy(seriesVersion = 2)))
            }
            jdbc.sql("UPDATE session_group_links SET is_exception=true WHERE series_id=:id AND original_date=:date").param("id", series).param("date", date).update()
            assertThrows(ResponseStatusException::class.java) { occurrence.materialize(series, date, 1) }
            assertThrows(ResponseStatusException::class.java) { enquiries.submit(UUID.randomUUID(), input) }
            assertEquals(1, jdbc.sql("SELECT count(*) FROM session_group_links WHERE series_id=:id AND original_date=:date").param("id", series).param("date", date).query(Int::class.java).single())
        } finally {
            jdbc.sql("UPDATE concept_state SET mode='ADMIN_ENQUIRIES_V1' WHERE id=1").update()
        }
    }

    @Test
    @Transactional
    fun `plan checks real draft intervals and fails closed on malformed drafts`() {
        val actor = accounts.createAdmin("draft-plan-check", "Администратор", "Test-pass-2026").id
        val session = UUID.randomUUID()
        val date = LocalDate.parse("2060-01-01").with(java.time.temporal.TemporalAdjusters.nextOrSame(java.time.DayOfWeek.WEDNESDAY))
        val zone = java.time.ZoneId.of("Europe/Moscow")
        val base = date.atTime(22, 0).atZone(zone).toInstant()
        jdbc.sql("INSERT INTO studio_sessions(id,title,format,starts_at,ends_at,capacity,status) VALUES(:id,'Черновик','GROUP',:start,:end,8,'OPEN')")
            .param("id", session).param("start", base.atOffset(java.time.ZoneOffset.UTC)).param("end", base.plusSeconds(1800).atOffset(java.time.ZoneOffset.UTC)).update()
        fun payload(start: Instant) = json.writeValueAsString(SessionInput("Черновик", "GROUP", start, start.plusSeconds(1800), 8))
        val harmless = date.atTime(20, 0).atZone(zone).toInstant()
        jdbc.sql("INSERT INTO session_edit_drafts(session_id,base_session_version,payload,actor_id,updated_at) VALUES(:id,0,CAST(:payload AS jsonb),:actor,now())")
            .param("id", session).param("actor", actor).param("payload", payload(harmless)).update()
        val input = PermanentPlanInput(UUID.fromString("b8c0a000-0000-4000-8000-000000000003"), 0,
            date, 8, listOf(PermanentSlotInput(3, LocalTime.of(2, 13), 40)))
        assertTrue(permanentPlans.preview(input).canPublish)
        val occupied = date.atTime(2, 13).atZone(zone).toInstant()
        jdbc.sql("UPDATE session_edit_drafts SET payload=CAST(:payload AS jsonb) WHERE session_id=:id")
            .param("payload", payload(occupied)).param("id", session).update()
        val conflicting = permanentPlans.preview(input)
        assertFalse(conflicting.canPublish)
        assertTrue(conflicting.conflicts.any { it.source == "DRAFT" })
        jdbc.sql("UPDATE session_edit_drafts SET payload='{}'::jsonb WHERE session_id=:id").param("id", session).update()
        assertTrue(permanentPlans.preview(input).hasPendingDrafts)
        jdbc.sql("UPDATE session_edit_drafts SET payload=CAST(:payload AS jsonb) WHERE session_id=:id")
            .param("payload", payload(harmless)).param("id", session).update()
        val group = UUID.randomUUID()
        val series = UUID.randomUUID()
        val rule = SeriesRule(date, date.plusDays(21), listOf(3), LocalTime.of(2, 13), 40, "Черновик серии", 8)
        val draft = SeriesDraftInput(group, rule = rule)
        jdbc.sql("INSERT INTO schedule_groups(id,parameters) VALUES(:id,CAST('{\"name\":\"Черновик\"}' AS jsonb))").param("id", group).update()
        jdbc.sql("INSERT INTO session_series(id,group_id,draft,draft_version,draft_base_version) VALUES(:id,:groupId,CAST(:draft AS jsonb),1,0)")
            .param("id", series).param("groupId", group).param("draft", json.writeValueAsString(draft)).update()
        assertTrue(permanentPlans.preview(input).conflicts.any { it.source == "DRAFT" })
    }

    @Test
    fun `competing permanent plans publish atomically and repeated command replays`() {
        val actor = accounts.createAdmin("permanent-plan-check", "Администратор", "Test-pass-2026").id
        val direction = UUID.fromString("b8c0a000-0000-4000-8000-000000000003")
        val start = LocalDate.parse("2067-04-01")
        val input = PermanentPlanInput(direction, 0, start, 8,
            listOf(PermanentSlotInput(2, LocalTime.of(4, 0)), PermanentSlotInput(6, LocalTime.of(6, 0)),
                PermanentSlotInput(2, LocalTime.of(9, 0))))
        val duplicated = input.copy(slots = listOf(input.slots.first(), input.slots.first()))
        val duplicatePreview = permanentPlans.preview(duplicated)
        assertFalse(duplicatePreview.canPublish)
        assertThrows(ResponseStatusException::class.java) {
            permanentPlans.publish(actor, UUID.randomUUID().toString(), PermanentPlanPublish(duplicated, duplicatePreview.digest))
        }
        assertEquals("ADMIN_ENQUIRIES_V1", jdbc.sql("SELECT mode FROM concept_state WHERE id=1").query(String::class.java).single())
        val preview = permanentPlans.preview(input)
        assertTrue(preview.canPublish)
        assertEquals(3, preview.samples.size)
        try {
            val command = PermanentPlanPublish(input, preview.digest)
            val keys = listOf(UUID.randomUUID().toString(), UUID.randomUUID().toString())
            val gate = CountDownLatch(1)
            val pool = Executors.newFixedThreadPool(2)
            val results = try {
                keys.map { key -> pool.submit<Result<ru.lastochka.scheduling.dto.PermanentPlanPublished>> {
                    gate.await(); runCatching { permanentPlans.publish(actor, key, command) }
                } }.also { gate.countDown() }.map { it.get() }
            } finally { pool.shutdownNow() }
            assertEquals(1, results.count { it.isSuccess })
            assertEquals("PERMANENT_SCHEDULE_V1", jdbc.sql("SELECT mode FROM concept_state WHERE id=1").query(String::class.java).single())
            val winner = results.indexOfFirst { it.isSuccess }
            val published = results[winner].getOrThrow()
            assertEquals(3, published.seriesIds.size)
            assertTrue(legacyRecurrence.list().items.none { it.id in published.seriesIds })
            assertEquals("SCHEDULE_UPDATE_REQUIRED", assertThrows(ResponseStatusException::class.java) {
                legacyRecurrence.read(published.seriesIds.first())
            }.reason)
            assertEquals(published, permanentPlans.publish(actor, keys[winner], command))
            assertEquals(3, published.seriesIds.sumOf { id -> jdbc.sql("SELECT count(*) FROM permanent_series_revisions WHERE series_id=:id").param("id", id).query(Int::class.java).single() })
            val reference = ScheduleRuleReference(1, published.seriesIds.first(), preview.samples.first().first().date, 1)
            val concurrentReference = reference.copy(originalDate = reference.originalDate.plusWeeks(3))
            val concurrentGate = CountDownLatch(1)
            val concurrentPool = Executors.newFixedThreadPool(2)
            try {
                val adminDate = concurrentPool.submit<ru.lastochka.scheduling.dto.SessionView> {
                    concurrentGate.await()
                    permanentPlans.materialize(actor, UUID.randomUUID().toString(), concurrentReference)
                }
                val enquiry = concurrentPool.submit<ru.lastochka.enquiries.dto.EnquiryReceipt> {
                    concurrentGate.await()
                    enquiries.submit(UUID.randomUUID(), EnquiryInput("Проверка параллельности", "+79001234567", contractVersion = 2,
                        participantType = EnquiryParticipantType.SELF, participantAge = 34, calculatedSession = concurrentReference))
                }
                concurrentGate.countDown()
                val realId = adminDate.get().id
                assertEquals(realId, jdbc.sql("SELECT desired_session_id FROM enrollment_requests WHERE public_number=:number")
                    .param("number", enquiry.get().number).query(UUID::class.java).single())
                assertEquals(1, jdbc.sql("SELECT count(*) FROM session_group_links WHERE series_id=:series AND original_date=:date")
                    .param("series", reference.seriesId).param("date", concurrentReference.originalDate).query(Int::class.java).single())
            } finally { concurrentPool.shutdownNow() }
            val materializeKey = UUID.randomUUID().toString()
            val concrete = permanentPlans.materialize(actor, materializeKey, reference)
            assertEquals(concrete.id, permanentPlans.materialize(actor, materializeKey, reference).id)
            val cancelled = scheduling.applySessionAction(actor, concrete.id, UUID.randomUUID().toString(), SessionAction(concrete.version, "CANCEL", "Отмена занятия"))
            assertEquals("CANCELLED", cancelled.status)
            assertThrows(ResponseStatusException::class.java) {
                permanentPlans.materialize(actor, UUID.randomUUID().toString(), reference)
            }
            val secondReference = reference.copy(originalDate = reference.originalDate.plusWeeks(1))
            val second = permanentPlans.materialize(actor, UUID.randomUUID().toString(), secondReference)
            enquiries.submit(UUID.randomUUID(), EnquiryInput("Проверка", "+79001234567", contractVersion = 2,
                participantType = EnquiryParticipantType.SELF, participantAge = 34,
                calculatedSession = secondReference))
            val snapshot = jdbc.sql("SELECT desired_session_snapshot FROM enrollment_requests WHERE desired_session_id=:id")
                .param("id", second.id).query(String::class.java).single()
            val change = PermanentRuleChange(published.seriesIds.first(), 1,
                input.copy(startDate = reference.originalDate,
                    slots = listOf(input.slots.first().copy(time = LocalTime.of(7, 0)))))
            val revisionPreview = permanentPlans.previewChange(change)
            assertTrue(revisionPreview.canPublish)
            assertTrue(revisionPreview.affected.any { it.session.id == second.id && it.action == "CHANGE" })
            assertFalse(revisionPreview.affected.any { it.session.id == concrete.id })
            val revised = permanentPlans.change(actor, UUID.randomUUID().toString(),
                PermanentRuleChangePublish(change, revisionPreview.digest))
            assertEquals(2L, revised.version)
            assertEquals(second.id, scheduling.find(second.id).id)
            assertEquals(second.startsAt.plusSeconds(3 * 3600), scheduling.find(second.id).startsAt)
            assertEquals(snapshot, jdbc.sql("SELECT desired_session_snapshot FROM enrollment_requests WHERE desired_session_id=:id")
                .param("id", second.id).query(String::class.java).single())
            val revisedSession = scheduling.find(second.id)
            val movedInput = SessionInput(revisedSession.title, "GROUP", revisedSession.startsAt.plusSeconds(86400),
                revisedSession.endsAt.plusSeconds(86400), revisedSession.capacity,
                revisedSession.ageFrom, revisedSession.ageTo, ageOpenEnded = revisedSession.ageOpenEnded)
            val moved = scheduling.update(actor, second.id, UUID.randomUUID().toString(),
                SessionUpdate(revisedSession.version, movedInput))
            assertEquals(second.id, moved.id)
            assertEquals(revisedSession.startsAt.plusSeconds(86400), moved.startsAt)
            assertThrows(ResponseStatusException::class.java) {
                permanentPlans.materialize(actor, UUID.randomUUID().toString(), secondReference.copy(seriesVersion = 2))
            }
            assertEquals(snapshot, jdbc.sql("SELECT desired_session_snapshot FROM enrollment_requests WHERE desired_session_id=:id")
                .param("id", second.id).query(String::class.java).single())
            val thirdReference = reference.copy(originalDate = reference.originalDate.plusWeeks(2), seriesVersion = 2)
            val third = permanentPlans.materialize(actor, UUID.randomUUID().toString(), thirdReference)
            val stop = PermanentRuleStop(reference.seriesId, 2, secondReference.originalDate)
            val stopPreview = permanentPlans.previewStop(stop)
            assertTrue(stopPreview.canPublish)
            assertTrue(stopPreview.affected.any { it.session.id == third.id && it.action == "CANCEL" })
            assertFalse(stopPreview.affected.any { it.session.id == second.id })
            assertEquals(3L, permanentPlans.stop(actor, UUID.randomUUID().toString(),
                PermanentStopPublish(stop, stopPreview.digest)).version)
            assertEquals("CANCELLED", scheduling.find(third.id).status)
            assertEquals("OPEN", scheduling.find(second.id).status)
            assertEquals(snapshot, jdbc.sql("SELECT desired_session_snapshot FROM enrollment_requests WHERE desired_session_id=:id")
                .param("id", second.id).query(String::class.java).single())
            assertEquals("CANCELLED", scheduling.find(concrete.id).status)
            assertThrows(ResponseStatusException::class.java) {
                permanentPlans.materialize(actor, UUID.randomUUID().toString(), reference.copy(seriesVersion = 2))
            }
            TransactionTemplate(txManager).executeWithoutResult {
                published.seriesIds.forEach { permanent.endCurrentAt(it, start.plusDays(21)) }
            }
        } finally {
            jdbc.sql("UPDATE concept_state SET mode='ADMIN_ENQUIRIES_V1' WHERE id=1").update()
        }
    }

    @Test
    @Transactional
    fun `a started occurrence is never rewritten by a same day rule change`() {
        val group = UUID.randomUUID()
        val series = UUID.randomUUID()
        val session = UUID.randomUUID()
        val direction = UUID.fromString("b8c0a000-0000-4000-8000-000000000003")
        val date = LocalDate.now(java.time.ZoneId.of("Europe/Moscow"))
        val start = date.atStartOfDay(java.time.ZoneId.of("Europe/Moscow")).toInstant()
        jdbc.sql("INSERT INTO schedule_groups(id,parameters) VALUES(:id,CAST('{\"name\":\"Прошедшее\"}' AS jsonb))").param("id", group).update()
        jdbc.sql("INSERT INTO session_series(id,group_id,age_direction_id) VALUES(:id,:groupId,:direction)").param("id", series).param("groupId", group).param("direction", direction).update()
        permanent.addPermanentSeries(series)
        permanent.advanceRevision(series, 0)
        permanent.addRevision(series, 1, date, null, date.dayOfWeek.value, LocalTime.MIDNIGHT, 30, direction, "8–9 лет", 8, 8, 9, false)
        jdbc.sql("INSERT INTO studio_sessions(id,title,format,starts_at,ends_at,capacity,status,age_from,age_to) VALUES(:id,'8–9 лет','GROUP',:start,:end,8,'OPEN',8,9)")
            .param("id", session).param("start", start.atOffset(java.time.ZoneOffset.UTC)).param("end", start.plusSeconds(1800).atOffset(java.time.ZoneOffset.UTC)).update()
        jdbc.sql("INSERT INTO session_group_links(session_id,group_id,series_id,original_date,is_exception) VALUES(:id,:groupId,:seriesId,:date,false)")
            .param("id", session).param("groupId", group).param("seriesId", series).param("date", date).update()
        val change = PermanentRuleChange(series, 1, PermanentPlanInput(direction, 0, date, 8,
            listOf(PermanentSlotInput(date.dayOfWeek.value, LocalTime.of(23, 59), 60))))
        val error = assertThrows(FieldValidationException::class.java) { permanentPlans.previewChange(change) }
        assertEquals("PERMANENT_CHANGE_AFTER_TODAY", error.fieldCodes["startDate"])
        val stopError = assertThrows(FieldValidationException::class.java) { permanentPlans.previewStop(PermanentRuleStop(series, 1, date)) }
        assertEquals("PERMANENT_CHANGE_AFTER_TODAY", stopError.fieldCodes["boundary"])
        assertFalse(jdbc.sql("SELECT is_exception FROM session_group_links WHERE session_id=:id").param("id", session).query(Boolean::class.java).single())
        assertEquals(start, scheduling.find(session).startsAt)
    }

    @Test
    fun `legacy publication checks calculated rule across midnight and respects cancellation`() {
        val actor = accounts.createAdmin("permanent-conflict-check", "Администратор", "Test-pass-2026").id
        val group = UUID.randomUUID()
        val series = UUID.randomUUID()
        val direction = UUID.fromString("b8c0a000-0000-4000-8000-000000000003")
        val date = LocalDate.parse("2077-01-12")
        val zone = java.time.ZoneId.of("Europe/Moscow")
        val start = date.plusDays(1).atTime(0, 15).atZone(zone).toInstant()
        TransactionTemplate(txManager).executeWithoutResult {
            jdbc.sql("INSERT INTO schedule_groups(id,parameters) VALUES(:id,CAST('{\"name\":\"Ночь\"}' AS jsonb))").param("id", group).update()
            jdbc.sql("INSERT INTO session_series(id,group_id,age_direction_id) VALUES(:id,:groupId,:direction)").param("id", series).param("groupId", group).param("direction", direction).update()
            permanent.addPermanentSeries(series)
            permanent.advanceRevision(series, 0)
            permanent.addRevision(series, 1, date, date.plusDays(1), date.dayOfWeek.value, LocalTime.of(23, 30), 90, direction, "8–9 лет", 8, 8, 9, false)
        }
        val draft = scheduling.create(actor, UUID.randomUUID().toString(), SessionInput("Индивидуальное", "INDIVIDUAL", start, start.plusSeconds(1800), 1))
        val error = assertThrows(ResponseStatusException::class.java) {
            scheduling.applySessionAction(actor, draft.id, UUID.randomUUID().toString(), SessionAction(draft.version, "PUBLISH"))
        }
        assertEquals("SCHEDULE_CONFLICT", error.reason)
        assertEquals("DRAFT", scheduling.find(draft.id).status)
        val cancelled = UUID.randomUUID()
        jdbc.sql("INSERT INTO studio_sessions(id,title,format,starts_at,ends_at,capacity,status) VALUES(:id,'Отменено','GROUP',:start,:end,8,'CANCELLED')")
            .param("id", cancelled).param("start", start.minusSeconds(2700).atOffset(java.time.ZoneOffset.UTC)).param("end", start.plusSeconds(2700).atOffset(java.time.ZoneOffset.UTC)).update()
        jdbc.sql("INSERT INTO session_group_links(session_id,group_id,series_id,original_date,is_exception) VALUES(:id,:groupId,:seriesId,:date,true)")
            .param("id", cancelled).param("groupId", group).param("seriesId", series).param("date", date).update()
        val published = scheduling.applySessionAction(actor, draft.id, UUID.randomUUID().toString(), SessionAction(draft.version, "PUBLISH"))
        assertEquals("OPEN", published.status)
    }

    @Test
    fun `bounded extension resumes and does not revive an exception`() {
        val actor = accounts.createAdmin("extension-change-check", "Администратор", "Test-pass-2026").id
        val group = UUID.randomUUID()
        val series = UUID.randomUUID()
        val direction = UUID.fromString("b8c0a000-0000-4000-8000-000000000003")
        val date = LocalDate.now(java.time.ZoneId.of("Europe/Moscow")).plusDays(7)
        val tx = TransactionTemplate(txManager)
        tx.executeWithoutResult {
            jdbc.sql("INSERT INTO schedule_groups(id,parameters) VALUES(:id,CAST('{\"name\":\"Продление\"}' AS jsonb))").param("id", group).update()
            jdbc.sql("INSERT INTO session_series(id,group_id,age_direction_id) VALUES(:id,:groupId,:direction)").param("id", series).param("groupId", group).param("direction", direction).update()
            permanent.addPermanentSeries(series)
            permanent.advanceRevision(series, 0)
            permanent.addRevision(series, 1, date, date.plusDays(56), date.dayOfWeek.value, LocalTime.of(3, 12), 60, direction, "8–9 лет", 8, 8, 9, false)
            jdbc.sql("UPDATE concept_state SET mode='PERMANENT_SCHEDULE_V1' WHERE id=1").update()
        }
        try {
            fun count() = jdbc.sql("SELECT count(*) FROM session_group_links WHERE series_id=:id").param("id", series).query(Int::class.java).single()
            val notificationsBefore = jdbc.sql("SELECT count(*) FROM telegram_outbox").query(Int::class.java).single()
            val paymentsBefore = jdbc.sql("SELECT count(*) FROM payment_requests").query(Int::class.java).single()
            assertEquals(2, extension.extend(2))
            assertEquals(2, count())
            jdbc.sql("UPDATE session_group_links SET is_exception=true WHERE series_id=:id AND original_date=:date").param("id", series).param("date", date).update()
            val exceptionId = jdbc.sql("SELECT session_id FROM session_group_links WHERE series_id=:id AND original_date=:date").param("id", series).param("date", date).query(UUID::class.java).single()
            val beforeException = scheduling.find(exceptionId)
            val update = PermanentRuleChange(series, 1, PermanentPlanInput(direction, 0, date, 8,
                listOf(PermanentSlotInput(date.dayOfWeek.value, LocalTime.of(3, 30), 60))))
            val preview = permanentPlans.previewChange(update)
            assertTrue(preview.canPublish)
            permanentPlans.change(actor, UUID.randomUUID().toString(), PermanentRuleChangePublish(update, preview.digest))
            assertEquals(beforeException, scheduling.find(exceptionId))
            assertEquals(2, extension.extend(2))
            assertEquals(4, count())
            repeat(6) { extension.extend(2) }
            val full = count()
            assertTrue(full in 7..8)
            assertEquals(0, extension.extend(2))
            assertEquals(full, count())
            assertEquals(notificationsBefore, jdbc.sql("SELECT count(*) FROM telegram_outbox").query(Int::class.java).single())
            assertEquals(paymentsBefore, jdbc.sql("SELECT count(*) FROM payment_requests").query(Int::class.java).single())
            assertEquals(1, jdbc.sql("SELECT count(*) FROM session_group_links WHERE series_id=:id AND original_date=:date AND is_exception").param("id", series).param("date", date).query(Int::class.java).single())
        } finally {
            TransactionTemplate(txManager).executeWithoutResult { permanent.endCurrentAt(series, date.plusDays(56)) }
            jdbc.sql("UPDATE concept_state SET mode='ADMIN_ENQUIRIES_V1' WHERE id=1").update()
        }
    }

    @Test
    fun `extension processes a larger backlog in bounded batches without duplicates`() {
        assertEquals(268435456L, db.containerInfo.hostConfig.memory)
        assertEquals(1000000000L, db.containerInfo.hostConfig.nanoCPUs)
        if (System.getProperty("lastochka.resource-check") == "true") {
            assertEquals(1, Runtime.getRuntime().availableProcessors())
            assertTrue(Runtime.getRuntime().maxMemory() <= 503316480L)
        }
        val direction = UUID.fromString("b8c0a000-0000-4000-8000-000000000003")
        val first = LocalDate.now(java.time.ZoneId.of("Europe/Moscow")).plusDays(7)
        val group = UUID.randomUUID()
        val seriesIds = (1..20).map { UUID.randomUUID() }
        TransactionTemplate(txManager).executeWithoutResult {
            jdbc.sql("INSERT INTO schedule_groups(id,parameters) VALUES(:id,CAST('{\"name\":\"Нагрузка\"}' AS jsonb))").param("id", group).update()
            seriesIds.forEachIndexed { index, series ->
                jdbc.sql("INSERT INTO session_series(id,group_id,age_direction_id) VALUES(:id,:groupId,:direction)").param("id", series).param("groupId", group).param("direction", direction).update()
                permanent.addPermanentSeries(series)
                permanent.advanceRevision(series, 0)
                permanent.addRevision(series, 1, first, first.plusDays(28), first.dayOfWeek.value,
                    LocalTime.of(5, 0).plusMinutes(index.toLong() * 10), 5, direction, "8–9 лет", 8, 8, 9, false)
            }
            jdbc.sql("UPDATE concept_state SET mode='PERMANENT_SCHEDULE_V1' WHERE id=1").update()
        }
        try {
            fun count(): Int = jdbc.sql("SELECT count(*) FROM session_group_links WHERE series_id IN (:ids)")
                .param("ids", seriesIds).query(Int::class.java).single()
            assertEquals(25, extension.extend())
            assertEquals(25, count())
            repeat(5) { extension.extend() }
            assertEquals(80, count())
            assertEquals(0, extension.extend())
            assertEquals(80, count())
        } finally {
            jdbc.sql("UPDATE concept_state SET mode='ADMIN_ENQUIRIES_V1' WHERE id=1").update()
        }
    }

    @Test
    fun `adult direction materializes without widening legacy command validation`() {
        val actor = accounts.createAdmin("adult-direction-check", "Администратор", "Test-pass-2026").id
        val group = UUID.randomUUID()
        val series = UUID.randomUUID()
        val direction = UUID.randomUUID()
        val date = LocalDate.parse("2095-02-07")
        val start = date.atTime(17, 0).atZone(java.time.ZoneId.of("Europe/Moscow")).toInstant()
        val input = SessionInput("Взрослые", "GROUP", start, start.plusSeconds(3600), 8, 18, 35)
        assertThrows(FieldValidationException::class.java) { scheduling.validateSession(input) }
        val tx = TransactionTemplate(txManager)
        tx.executeWithoutResult {
            jdbc.sql("INSERT INTO age_directions(id,title,age_from,age_to,age_open_ended) VALUES(:id,'Взрослые',18,35,false)").param("id", direction).update()
            jdbc.sql("INSERT INTO schedule_groups(id,parameters) VALUES(:id,CAST('{\"name\":\"Взрослые\"}' AS jsonb))").param("id", group).update()
            jdbc.sql("INSERT INTO session_series(id,group_id,age_direction_id) VALUES(:id,:groupId,:direction)").param("id", series).param("groupId", group).param("direction", direction).update()
            permanent.addPermanentSeries(series)
            permanent.advanceRevision(series, 0)
            permanent.addRevision(series, 1, date, null, date.dayOfWeek.value, LocalTime.of(17, 0), 60, direction, "Взрослые", 8, 18, 35, false)
            jdbc.sql("UPDATE concept_state SET mode='PERMANENT_SCHEDULE_V1' WHERE id=1").update()
        }
        try {
            val session = occurrence.materialize(series, date, 1)
            assertEquals(18, session.ageFrom)
            assertEquals(35, session.ageTo)
            assertEquals(session.id, occurrence.materialize(series, date, 1).id)
        } finally {
            jdbc.sql("UPDATE concept_state SET mode='ADMIN_ENQUIRIES_V1' WHERE id=1").update()
        }
        try {
            val oneOff = input.copy(title = "Не используется", startsAt = start.plusSeconds(7200),
                endsAt = start.plusSeconds(10800), ageFrom = null, ageTo = null,
                ageDirectionId = direction, ageDirectionVersion = 0)
            val key = UUID.randomUUID().toString()
            val created = scheduling.create(actor, key, oneOff)
            assertEquals("Взрослые", created.title)
            assertEquals(18, created.ageFrom)
            assertEquals(35, created.ageTo)
            assertEquals(created.id, scheduling.create(actor, key, oneOff).id)
            assertEquals("PERMANENT_SCHEDULE_V1", jdbc.sql("SELECT mode FROM concept_state WHERE id=1").query(String::class.java).single())
            assertThrows(ResponseStatusException::class.java) {
                scheduling.create(actor, UUID.randomUUID().toString(), oneOff.copy(ageDirectionVersion = 1))
            }
            val revised = scheduling.update(actor, created.id, UUID.randomUUID().toString(),
                SessionUpdate(created.version, oneOff.copy(title = "Взрослые", ageFrom = 18, ageTo = 35)))
            assertEquals(18, revised.ageFrom)
            assertEquals("OPEN", scheduling.applySessionAction(actor, revised.id, UUID.randomUUID().toString(),
                SessionAction(revised.version, "PUBLISH")).status)
        } finally {
            jdbc.sql("UPDATE concept_state SET mode='ADMIN_ENQUIRIES_V1' WHERE id=1").update()
        }
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
        val schedulePath = "/api/v1/admin/permanent-schedule/preview"
        val scheduleBody = json.writeValueAsString(PermanentPlanInput(
            UUID.fromString("b8c0a000-0000-4000-8000-000000000003"), 0,
            LocalDate.parse("2050-01-01"), 8, listOf(PermanentSlotInput(3, LocalTime.of(3, 0)))))
        assertEquals(200, request(adminClient, "POST", schedulePath, scheduleBody, adminToken).statusCode())
        assertEquals(200, request(editorClient, "POST", schedulePath, scheduleBody, editorToken).statusCode())
        assertEquals(403, request(otherClient, "POST", schedulePath, scheduleBody, otherToken).statusCode())
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
        // Exercise the real HTTP contract as an authorised STAFF editor on this disposable DB.
        try {
            val initial = PermanentPlanInput(UUID.fromString("b8c0a000-0000-4000-8000-000000000003"),
                0, LocalDate.parse("2050-01-01"), 8, listOf(PermanentSlotInput(3, LocalTime.of(3, 0))))
            val planned = request(editorClient, "POST", "/api/v1/admin/permanent-schedule/preview",
                json.writeValueAsString(initial), editorToken)
            assertEquals(200, planned.statusCode(), planned.body())
            val planJson = json.readTree(planned.body())
            assertTrue(planJson.path("canPublish").asBoolean())
            val response = request(editorClient, "POST", "/api/v1/admin/permanent-schedule/publish",
                json.writeValueAsString(PermanentPlanPublish(initial, planJson.path("digest").asString())), editorToken)
            assertEquals(200, response.statusCode(), response.body())
            val series = UUID.fromString(json.readTree(response.body()).path("seriesIds").get(0).asString())
            val date = LocalDate.parse(planJson.path("samples").get(0).get(0).path("date").asString())
            val from = date.atStartOfDay(java.time.ZoneId.of("Europe/Moscow")).toInstant()
            val query = "?from=$from&to=${from.plusSeconds(7 * 86400)}&page=0&size=20"
            val publicView = request(editorClient, "GET", "/api/v1/public/schedule$query")
            assertEquals(200, publicView.statusCode(), publicView.body())
            assertTrue(json.readTree(publicView.body()).path("items").any { it.path("kind").asString() == "CALCULATED" })
            val legacy = request(editorClient, "GET", "/api/v1/sessions$query")
            assertEquals(409, legacy.statusCode(), legacy.body())
            val reference = ScheduleRuleReference(1, series, date, 1)
            val materialized = request(editorClient, "POST", "/api/v1/admin/permanent-schedule/occurrence",
                json.writeValueAsString(reference), editorToken)
            assertEquals(200, materialized.statusCode(), materialized.body())
            val session = json.readTree(materialized.body())
            val cancelled = request(editorClient, "POST", "/api/v1/admin/sessions/${session.path("id").asString()}/actions",
                json.writeValueAsString(SessionAction(session.path("version").asLong(), "CANCEL", "Тестовая отмена")), editorToken)
            assertEquals(200, cancelled.statusCode(), cancelled.body())
            assertEquals("CANCELLED", json.readTree(cancelled.body()).path("status").asString())
            val change = PermanentRuleChange(series, 1, initial.copy(slots = listOf(initial.slots.single().copy(time = LocalTime.of(4, 0)))))
            val changePreview = request(editorClient, "POST", "/api/v1/admin/permanent-schedule/change/preview",
                json.writeValueAsString(change), editorToken)
            assertEquals(200, changePreview.statusCode(), changePreview.body())
            val changeBody = PermanentRuleChangePublish(change, json.readTree(changePreview.body()).path("digest").asString())
            val changed = request(editorClient, "POST", "/api/v1/admin/permanent-schedule/change", json.writeValueAsString(changeBody), editorToken)
            assertEquals(200, changed.statusCode(), changed.body())
            val stop = PermanentRuleStop(series, 2, initial.startDate)
            val stopPreview = request(editorClient, "POST", "/api/v1/admin/permanent-schedule/stop/preview", json.writeValueAsString(stop), editorToken)
            assertEquals(200, stopPreview.statusCode(), stopPreview.body())
            val stopBody = PermanentStopPublish(stop, json.readTree(stopPreview.body()).path("digest").asString())
            val stopped = request(editorClient, "POST", "/api/v1/admin/permanent-schedule/stop", json.writeValueAsString(stopBody), editorToken)
            assertEquals(200, stopped.statusCode(), stopped.body())
        } finally {
            jdbc.sql("UPDATE concept_state SET mode='ADMIN_ENQUIRIES_V1' WHERE id=1").update()
        }
    }
}
