package ru.lastochka.integration

import java.net.CookieManager
import java.net.URI
import java.net.http.*
import java.sql.DriverManager
import java.time.Instant
import java.util.UUID
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Assertions.assertNull
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.web.server.ResponseStatusException
import org.testcontainers.postgresql.PostgreSQLContainer
import ru.lastochka.enquiries.dto.EnquiryInput
import ru.lastochka.enquiries.dto.EnquiryParticipantType
import ru.lastochka.enquiries.service.EnquiryService
import ru.lastochka.identity.service.*
import ru.lastochka.notifications.service.TelegramQueue
import ru.lastochka.payments.dto.PaymentInput
import ru.lastochka.payments.service.PaymentService
import ru.lastochka.scheduling.dto.*
import ru.lastochka.scheduling.service.WeeklyScheduleService
import tools.jackson.databind.json.JsonMapper

@ActiveProfiles("test")
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = ["lastochka.workers.enabled=false"],
)
@TestMethodOrder(MethodOrderer.OrderAnnotation::class)
class AdminConceptIntegrationTest {
    companion object {
        val oldAdmin = UUID.fromString("00000000-0000-0000-0000-000000000001")
        private val db = PostgreSQLContainer("postgres:17.6-alpine").apply { start() }

        init {
            Flyway.configure()
                .dataSource(db.jdbcUrl, db.username, db.password)
                .locations("classpath:db/migration")
                .target("9")
                .load()
                .migrate()
            DriverManager.getConnection(db.jdbcUrl, db.username, db.password).use { c ->
                c.createStatement().use { s ->
                    s.execute(
                        "INSERT INTO accounts(id,email,name,password_hash,role,verified_at,additional_role) VALUES('$oldAdmin','old-admin@fixture.test','Legacy admin','unchanged-admin-hash','ADMIN',now(),'DOCTOR'),('00000000-0000-0000-0000-000000000002','old-parent@fixture.test','Legacy parent','obsolete-parent-hash','PARENT',now(),NULL)"
                    )
                    s.execute(
                        "INSERT INTO children(id,parent_id,name,birth_date) VALUES('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','Legacy child','2018-01-01')"
                    )
                    s.execute(
                        "INSERT INTO studio_sessions(id,title,format,starts_at,ends_at,capacity,status) VALUES('00000000-0000-0000-0000-000000000004','Legacy session','GROUP',now()+interval '30 days',now()+interval '30 days 1 hour',8,'OPEN')"
                    )
                    s.execute(
                        "INSERT INTO bookings(id,child_id,parent_id,session_id,status,created_by) VALUES('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000004','CONFIRMED','$oldAdmin')"
                    )
                    s.execute(
                        "INSERT INTO auth_tokens(hash,account_id,kind,expires_at) VALUES('old-reset','00000000-0000-0000-0000-000000000002','RESET',now()+interval '1 hour')"
                    )
                    s.execute(
                        "INSERT INTO webauthn_challenges(session_id,account_id,kind,payload,expires_at) VALUES('old-challenge','$oldAdmin','ASSERTION','{}',now()+interval '1 hour')"
                    )
                    s.execute(
                        "INSERT INTO move_previews(id,actor_id,kind,source_id,payload,fingerprint,generation,expires_at) VALUES(gen_random_uuid(),'$oldAdmin','SESSION','00000000-0000-0000-0000-000000000004','{}','old-fingerprint','old-generation',now()+interval '1 hour')"
                    )
                    s.execute(
                        "INSERT INTO idempotency_records(actor_id,operation,key,request_hash,response,expires_at) VALUES('$oldAdmin','legacy-command','old-command','old-hash','{}',now()+interval '1 hour')"
                    )
                    s.execute(
                        "INSERT INTO spring_session(primary_id,session_id,creation_time,last_access_time,max_inactive_interval,expiry_time) VALUES('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000011',0,0,1800,9999999999999)"
                    )
                    s.execute(
                        "INSERT INTO user_entities(id,name,display_name) VALUES('legacy-admin-key','old-admin@fixture.test','Legacy admin'),('legacy-parent-key','old-parent@fixture.test','Legacy parent')"
                    )
                    s.execute(
                        "INSERT INTO user_credentials(credential_id,user_entity_user_id,public_key,signature_count,uv_initialized,backup_eligible,authenticator_transports,public_key_credential_type,backup_state,created,last_used,label) VALUES('admin-credential','legacy-admin-key',decode('aabb','hex'),0,true,false,'internal','public-key',false,now(),now(),'Admin key'),('parent-credential','legacy-parent-key',decode('ccdd','hex'),0,true,false,'internal','public-key',false,now(),now(),'Parent key')"
                    )
                    s.execute(
                        "INSERT INTO notification_outbox(event_id,aggregate_id,recipient,subject,body) VALUES(gen_random_uuid(),'00000000-0000-0000-0000-000000000005','old-parent@fixture.test','old mail','obsolete body')"
                    )
                }
            }
            Flyway.configure().dataSource(db.jdbcUrl, db.username, db.password)
                .locations("classpath:db/migration").target("31").load().migrate()
            DriverManager.getConnection(db.jdbcUrl, db.username, db.password).use { connection ->
                connection.createStatement().use { statement ->
                    statement.execute("SET TIME ZONE 'UTC'")
                    val rows = statement.executeQuery("SELECT md5(string_agg(to_jsonb(s)::text, E'\\n' ORDER BY id)) FROM studio_sessions s")
                    rows.next()
                    val fingerprint = rows.getString(1)
                    statement.execute("ALTER DATABASE ${db.databaseName} SET lastochka.reviewed_calendar = '$fingerprint'")
                }
            }
        }

        @JvmStatic
        @DynamicPropertySource
        fun database(r: DynamicPropertyRegistry) {
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

    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var landing: ru.lastochka.content.repo.LandingContentRepository
    @Autowired lateinit var accounts: AccountService
    @Autowired lateinit var access: AdminAccessService
    @Autowired lateinit var enquiries: EnquiryService
    @Autowired lateinit var payments: PaymentService
    @Autowired lateinit var scheduling: WeeklyScheduleService
    @Autowired lateinit var telegram: TelegramQueue
    @Autowired
    lateinit var notificationSettings:
        ru.lastochka.notifications.service.NotificationSettingsService
    @Autowired lateinit var json: JsonMapper
    @Autowired lateinit var pushStorage: ru.lastochka.notifications.repo.PushSubscriptionRepository
    @Autowired lateinit var pushOutbox: ru.lastochka.notifications.repo.PushOutboxRepository
    @Autowired lateinit var pushRoutes: ru.lastochka.notifications.service.NotificationRoutes
    @Autowired
    lateinit var pushRouteStorage: ru.lastochka.notifications.repo.NotificationRoutesRepository
    @Autowired lateinit var txManager: org.springframework.transaction.PlatformTransactionManager
    @LocalServerPort var port: Int = 0

    fun count(table: String) =
        if (
            jdbc
                .sql("SELECT to_regclass(:name)::text")
                .param("name", table)
                .query(String::class.java)
                .optional()
                .isEmpty
        )
            0L
        else jdbc.sql("SELECT count(*) FROM $table").query(Long::class.java).single()

    fun input() =
        EnquiryInput(
            "Родитель",
            "8 (900) 123-45-67",
            "Ребёнок",
            7,
            comment = "<b>Обычный текст</b>",
        )

    fun admin() =
        accounts.createAdmin(
            "admin" + UUID.randomUUID().toString().take(8),
            "Администратор",
            "Test-pass-2026",
        )

    @Test
    @Order(1)
    fun `V9 transition deletes parent family bookings but preserves admin schedule content`() {
        assertEquals(1, count("accounts"))
        assertEquals(0, count("children"))
        assertEquals(0, count("bookings"))
        assertEquals(0, count("studio_sessions"))
        assertEquals(1, count("landing_content"))
        assertEquals(0, count("notification_outbox"))
        val a = accounts.find("old-admin@fixture.test")!!
        assertEquals("unchanged-admin-hash", a.passwordHash)
        assertNull(a.additionalRole)
        assertFalse(a.adminEnabled)
        assertEquals(
            listOf("admin-credential"),
            jdbc.sql("SELECT credential_id FROM user_credentials").query(String::class.java).list(),
        )
        for (table in
            listOf(
                "auth_tokens",
                "webauthn_challenges",
                "move_previews",
                "idempotency_records",
                "spring_session",
            )) assertEquals(0, count(table))
        assertEquals(
            listOf("legacy-admin-key"),
            jdbc.sql("SELECT id FROM user_entities").query(String::class.java).list(),
        )
        assertEquals(
            "ADMIN_ENQUIRIES_V1",
            jdbc.sql("SELECT mode FROM concept_state").query(String::class.java).single(),
        )
    }

    @Test
    fun `predefined login normalization and operator password reset`() {
        access.provision(oldAdmin, "  configured-admin  ")
        access.reset(oldAdmin, "Changed-123")
        assertEquals(oldAdmin, accounts.password("CONFIGURED-ADMIN", "Changed-123").id)
        assertThrows<ResponseStatusException> {
            accounts.password("old-admin@fixture.test", "Changed-123")
        }
        access.provision(oldAdmin, "configured-admin")
    }

    @Test
    fun `enquiry and outbox commit together without reservation and normalize phone`() = withVkSelected {
        val before = count("bookings")
        val key = UUID.randomUUID()
        val receipt = enquiries.submit(key, input())
        val again = enquiries.submit(key, input())
        assertEquals(receipt, again)
        assertEquals(before, count("bookings"))
        val stored =
            jdbc
                .sql("SELECT phone FROM enrollment_requests WHERE public_number=:number")
                .param("number", receipt.number)
                .query(String::class.java)
                .single()
        assertEquals("+79001234567", stored)
        assertEquals(
            1,
            jdbc
                .sql(
                    "SELECT count(*) FROM vk_enquiry_outbox t JOIN enrollment_requests e ON e.id=t.enquiry_id WHERE e.public_number=:n"
                )
                .param("n", receipt.number)
                .query(Int::class.java)
                .single(),
        )
        assertThrows<ResponseStatusException> { enquiries.submit(key, input().copy(childAge = 8)) }
    }

    @Test
    fun `minimal enquiry keeps absent child details and one replay event`() {
        val key = UUID.randomUUID()
        val minimal = EnquiryInput(parentName = "Родитель", phone = "+79001234567")
        val receipt = enquiries.submit(key, minimal)
        assertEquals(receipt, enquiries.submit(key, minimal))
        val saved = enquiries.page(0).items.first { it.number == receipt.number }
        assertNull(saved.childName)
        assertNull(saved.childAge)
        assertEquals(0, jdbc.sql("SELECT count(*) FROM vk_enquiry_outbox WHERE enquiry_id=:id")
            .param("id", saved.id).query(Int::class.java).single())
        assertThrows<ResponseStatusException> {
            enquiries.submit(key, minimal.copy(parentName = "Другое имя"))
        }
    }

    @Test
    fun `legacy replay hash remains usable after optional child fields`() {
        val key = UUID.randomUUID()
        val original = input()
        val receipt = enquiries.submit(key, original)
        val legacyJson =
            """{"parentName":"Родитель","phone":"+79001234567","childName":"Ребёнок","childAge":7,"desiredSessionId":null,"desiredSessionVersion":null,"comment":"<b>Обычный текст</b>"}"""
        val legacyHash =
            java.security.MessageDigest.getInstance("SHA-256")
                .digest(legacyJson.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
        jdbc
            .sql("UPDATE enquiry_replays SET request_hash=:hash WHERE key=:key")
            .param("hash", legacyHash)
            .param("key", key)
            .update()
        assertEquals(receipt, enquiries.submit(key, original))
    }

    @Test
    fun `version two stores adults and children distinctly and preserves replay`() {
        val self = EnquiryInput(
            parentName = "Анна", phone = "+79001234567", contractVersion = 2,
            participantType = EnquiryParticipantType.SELF, participantAge = 34,
        )
        val selfKey = UUID.randomUUID()
        val receipt = enquiries.submit(selfKey, self)
        assertEquals(receipt, enquiries.submit(selfKey, self))
        val saved = enquiries.page(0).items.first { it.number == receipt.number }
        assertEquals(EnquiryParticipantType.SELF, saved.participantType)
        assertEquals(34, saved.participantAge)
        assertNull(saved.childAge)
        assertNull(saved.childName)
        assertThrows<ResponseStatusException> { enquiries.submit(selfKey, self.copy(participantAge = 35)) }

        val child = self.copy(participantType = EnquiryParticipantType.CHILD,
            participantAge = null, childName = "Маша", childAge = 8)
        val childReceipt = enquiries.submit(UUID.randomUUID(), child)
        val childSaved = enquiries.page(0).items.first { it.number == childReceipt.number }
        assertEquals(EnquiryParticipantType.CHILD, childSaved.participantType)
        assertEquals("Маша", childSaved.childName)
        assertEquals(8, childSaved.childAge)
        assertNull(childSaved.participantAge)
    }

    @Test
    fun `version three stores the category snapshot and notifies both channels`() = withVkSelected {
        val direction = UUID.fromString("b8c0a000-0000-4000-8000-000000000002")
        val archived = UUID.randomUUID()
        jdbc.sql(
            "INSERT INTO age_directions(id,title,age_from,age_to,age_open_ended,active,sort_order) VALUES(:id,'Архивная',3,4,false,false,99)"
        ).param("id", archived).update()
        val a = admin()
        val sub = pushStorage.save(
            UUID.randomUUID(), a.id, a.authVersion, pushRoutes.generationHash,
            UUID.randomUUID().toString().replace("-", ""),
            ru.lastochka.notifications.dto.PushSubscriptionInput("https://example.test/push", "fake-key", "fake-auth"),
        )!!
        val settings = notificationSettings.get()
        try {
            notificationSettings.update(settings.copy(telegramEnabled = false, browserPushEnabled = true))
            val request = EnquiryInput(
                parentName = "Анна", phone = "+79001234567", contractVersion = 3,
                ageDirectionId = direction, participantName = "  Маша  ", comment = "<i>после 17</i>",
            )
            val key = UUID.randomUUID()
            val receipt = enquiries.submit(key, request)
            assertEquals(receipt, enquiries.submit(key, request))
            assertThrows<ResponseStatusException> {
                enquiries.submit(key, request.copy(ageDirectionId = UUID.fromString("b8c0a000-0000-4000-8000-000000000003")))
            }
            val saved = enquiries.page(0).items.first { it.number == receipt.number }
            assertEquals(direction, saved.ageDirection!!.id)
            assertEquals("6–7 лет", saved.ageDirection!!.title)
            assertEquals(6, saved.ageDirection!!.ageFrom)
            assertEquals(7, saved.ageDirection!!.ageTo)
            assertEquals("Маша", saved.participantName)
            assertNull(saved.participantType)
            assertNull(saved.childName)
            assertNull(saved.childAge)
            assertNull(saved.participantAge)
            assertEquals(1, jdbc.sql("SELECT count(*) FROM vk_enquiry_outbox WHERE enquiry_id=:id")
                .param("id", saved.id).query(Int::class.java).single())
            assertEquals(1, pushRoutes.summary(saved.id, true)!!.subscriptions)

            // Later dictionary edits do not rewrite the stored snapshot.
            jdbc.sql("UPDATE age_directions SET title='6–7 лет (изм.)' WHERE id=:id").param("id", direction).update()
            assertEquals("6–7 лет", enquiries.find(saved.id).ageDirection!!.title)
            jdbc.sql("UPDATE age_directions SET title='6–7 лет' WHERE id=:id").param("id", direction).update()

            val before = count("enrollment_requests")
            for (rejected in listOf(archived, UUID.randomUUID(), null)) {
                val error = assertThrows<ru.lastochka.common.error.FieldValidationException> {
                    enquiries.submit(UUID.randomUUID(), request.copy(ageDirectionId = rejected))
                }
                assertEquals("FIELD_AGE_DIRECTION", error.fieldCodes["ageDirectionId"])
            }
            assertEquals(before, count("enrollment_requests"))
        } finally {
            pushStorage.deactivate(sub, a.id)
            notificationSettings.update(
                notificationSettings.get().copy(
                    telegramEnabled = settings.telegramEnabled,
                    browserPushEnabled = settings.browserPushEnabled,
                )
            )
        }
    }

    @Test
    fun `version two validates participant and rejects contradictory payload`() {
        val input = EnquiryInput(parentName = "Анна", phone = "+79001234567", contractVersion = 2)
        assertThrows<ru.lastochka.common.error.FieldValidationException> { enquiries.submit(UUID.randomUUID(), input) }
        assertThrows<ru.lastochka.common.error.FieldValidationException> {
            enquiries.submit(UUID.randomUUID(), input.copy(participantType = EnquiryParticipantType.CHILD, childName = "Маша"))
        }
        assertThrows<ru.lastochka.common.error.FieldValidationException> {
            enquiries.submit(UUID.randomUUID(), input.copy(participantType = EnquiryParticipantType.SELF, participantAge = 121))
        }
        assertThrows<ru.lastochka.common.error.FieldValidationException> {
            enquiries.submit(UUID.randomUUID(), input.copy(participantType = EnquiryParticipantType.SELF, participantAge = 34, childAge = 8))
        }
    }

    @Test
    fun `concurrent minimal requests produce one enquiry and one event`() = withVkSelected {
        val key = UUID.randomUUID()
        val minimal = EnquiryInput(parentName = "Родитель", phone = "+79001234567")
        val executor = java.util.concurrent.Executors.newFixedThreadPool(2)
        try {
            val results =
                (1..2)
                    .map {
                        executor.submit<ru.lastochka.enquiries.dto.EnquiryReceipt> {
                            enquiries.submit(key, minimal)
                        }
                    }
                    .map { it.get() }
            assertEquals(results[0], results[1])
            assertEquals(
                1,
                jdbc
                    .sql(
                        "SELECT count(*) FROM vk_enquiry_outbox t JOIN enrollment_requests e ON e.id=t.enquiry_id WHERE e.public_number=:number"
                    )
                    .param("number", results[0].number)
                    .query(Int::class.java)
                    .single(),
            )
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun `push settings reject stale updates and retired telegram`() {
        val original = notificationSettings.get()
        assertFalse(original.telegramEnabled)
        assertThrows<ResponseStatusException> {
            notificationSettings.update(original.copy(telegramEnabled = true))
        }
        assertFalse(original.browserPushEnabled)
        try {
            val updated =
                notificationSettings.update(
                    original.copy(telegramEnabled = false, browserPushEnabled = true)
                )
            assertEquals(original.version + 1, updated.version)
            assertFalse(notificationSettings.get().telegramEnabled)
            assertTrue(notificationSettings.get().browserPushEnabled)
            assertThrows<ResponseStatusException> { notificationSettings.update(original) }
        } finally {
            val current = notificationSettings.get()
            notificationSettings.update(
                current.copy(telegramEnabled = false, browserPushEnabled = false)
            )
        }
    }

    @Test
    fun `selected channels enqueue independently and push admission is rechecked`() = withVkSelected {
        val a = admin()
        val sub =
            pushStorage.save(
                UUID.randomUUID(),
                a.id,
                a.authVersion,
                pushRoutes.generationHash,
                UUID.randomUUID().toString().replace("-", ""),
                ru.lastochka.notifications.dto.PushSubscriptionInput(
                    "https://example.test/push",
                    "fake-key",
                    "fake-auth",
                ),
            )!!
        val settings = notificationSettings.get()
        val sender =
            org.mockito.Mockito.mock(ru.lastochka.notifications.service.PushSender::class.java)
        org.mockito.Mockito.`when`(sender.configured()).thenReturn(true)
        val queue =
            ru.lastochka.notifications.service.PushQueue(pushOutbox, sender, pushRoutes, accounts)
        val tx = org.springframework.transaction.support.TransactionTemplate(txManager)
        try {
            notificationSettings.update(
                settings.copy(telegramEnabled = false, browserPushEnabled = true)
            )
            val key = UUID.randomUUID()
            val executor = java.util.concurrent.Executors.newFixedThreadPool(2)
            val receipt =
                try {
                    val results =
                        (1..2)
                            .map {
                                executor.submit<ru.lastochka.enquiries.dto.EnquiryReceipt> {
                                    enquiries.submit(
                                        key,
                                        EnquiryInput(
                                            parentName = "Родитель",
                                            phone = "+79001234567",
                                        ),
                                    )
                                }
                            }
                            .map { it.get() }
                    assertEquals(results.first(), results.last())
                    results.first()
                } finally {
                    executor.shutdownNow()
                }
            val saved = enquiries.page(0).items.first { it.number == receipt.number }
            val summary = pushRoutes.summary(saved.id, true)!!
            assertTrue(summary.selected)
            assertEquals(1, summary.subscriptions)
            assertEquals(1, summary.waiting)
            assertEquals(
                1,
                jdbc
                    .sql("SELECT count(*) FROM vk_enquiry_outbox WHERE enquiry_id=:id")
                    .param("id", saved.id)
                    .query(Int::class.java)
                    .single(),
            )
            val beforeRollback = count("enrollment_requests")
            val beforePush = count("browser_push_outbox")
            val beforeVk = count("vk_enquiry_outbox")
            tx.executeWithoutResult { status ->
                enquiries.submit(UUID.randomUUID(), input())
                status.setRollbackOnly()
            }
            assertEquals(beforeRollback, count("enrollment_requests"))
            assertEquals(beforePush, count("browser_push_outbox"))
            assertEquals(beforeVk, count("vk_enquiry_outbox"))
            val item = tx.execute { queue.claim() }!!
            org.mockito.Mockito.`when`(sender.send(item)).thenReturn(201 to null)
            tx.executeWithoutResult { queue.deliver(item) }
            assertEquals(1, pushRoutes.summary(saved.id, true)!!.accepted)
            assertEquals(0, pushRoutes.summary(saved.id, true)!!.waiting)
            val next = enquiries.submit(UUID.randomUUID(), input())
            val nextSaved = enquiries.page(0).items.first { it.number == next.number }
            val pending = tx.execute { queue.claim() }!!
            access.reset(a.id, "Changed-123")
            tx.executeWithoutResult { queue.deliver(pending) }
            assertEquals(1, pushRoutes.summary(nextSaved.id, true)!!.failed)
            org.mockito.Mockito.verify(sender, org.mockito.Mockito.never()).send(pending)
            val noDevices = enquiries.submit(UUID.randomUUID(), input())
            val noDevicesSaved = enquiries.page(0).items.first { it.number == noDevices.number }
            assertTrue(pushRoutes.summary(noDevicesSaved.id, true)!!.selected)
            assertEquals(0, pushRoutes.summary(noDevicesSaved.id, true)!!.subscriptions)
            notificationSettings.update(
                notificationSettings.get().copy(telegramEnabled = false, browserPushEnabled = false)
            )
            jdbc.sql("UPDATE vk_enquiry_settings SET enabled=false WHERE id=1").update()
            val silent = enquiries.submit(UUID.randomUUID(), input())
            val silentSaved = enquiries.page(0).items.first { it.number == silent.number }
            assertFalse(pushRoutes.summary(silentSaved.id, true)!!.selected)
            assertEquals(
                0,
                jdbc
                    .sql("SELECT count(*) FROM vk_enquiry_outbox WHERE enquiry_id=:id")
                    .param("id", silentSaved.id)
                    .query(Int::class.java)
                    .single(),
            )
        } finally {
            pushStorage.deactivate(sub, a.id)
            notificationSettings.update(
                notificationSettings
                    .get()
                    .copy(
                        telegramEnabled = settings.telegramEnabled,
                        browserPushEnabled = settings.browserPushEnabled,
                    )
            )
        }
    }

    @Test
    fun `push 429 waits and gone subscription stops future delivery`() {
        val a = admin()
        val sub =
            pushStorage.save(
                UUID.randomUUID(),
                a.id,
                a.authVersion,
                pushRoutes.generationHash,
                UUID.randomUUID().toString().replace("-", ""),
                ru.lastochka.notifications.dto.PushSubscriptionInput(
                    "https://example.test/push",
                    "fake-key",
                    "fake-auth",
                ),
            )!!
        val settings = notificationSettings.get()
        val sender =
            org.mockito.Mockito.mock(ru.lastochka.notifications.service.PushSender::class.java)
        org.mockito.Mockito.`when`(sender.configured()).thenReturn(true)
        val queue =
            ru.lastochka.notifications.service.PushQueue(pushOutbox, sender, pushRoutes, accounts)
        val tx = org.springframework.transaction.support.TransactionTemplate(txManager)
        try {
            notificationSettings.update(
                settings.copy(telegramEnabled = false, browserPushEnabled = true)
            )
            val receipt = enquiries.submit(UUID.randomUUID(), input())
            val saved = enquiries.page(0).items.first { it.number == receipt.number }
            val first = tx.execute { queue.claim() }!!
            assertNull(tx.execute { queue.claim() })
            jdbc
                .sql(
                    "UPDATE browser_push_outbox SET lease_until=now()-interval '1 second' WHERE enquiry_id=:id"
                )
                .param("id", saved.id)
                .update()
            val recovered = tx.execute { queue.claim() }!!
            assertEquals(first.enquiryId, recovered.enquiryId)
            assertEquals(first.attempts + 1, recovered.attempts)
            org.mockito.Mockito.`when`(sender.send(recovered)).thenReturn(429 to 120L)
            tx.executeWithoutResult { queue.deliver(recovered) }
            assertEquals(1, pushRoutes.summary(saved.id, true)!!.waiting)
            assertTrue(
                jdbc
                    .sql(
                        "SELECT next_attempt_at>now()+interval '100 seconds' FROM browser_push_outbox WHERE enquiry_id=:id"
                    )
                    .param("id", saved.id)
                    .query(Boolean::class.java)
                    .single()
            )
            assertNull(tx.execute { queue.claim() })
            jdbc
                .sql("UPDATE browser_push_outbox SET next_attempt_at=now() WHERE enquiry_id=:id")
                .param("id", saved.id)
                .update()
            val retry = tx.execute { queue.claim() }!!
            org.mockito.Mockito.`when`(sender.send(retry)).thenReturn(410 to null)
            tx.executeWithoutResult { queue.deliver(retry) }
            assertEquals(1, pushRoutes.summary(saved.id, true)!!.failed)
            assertFalse(pushStorage.active(sub, a.id, a.authVersion, pushRoutes.generationHash))
            val later = enquiries.submit(UUID.randomUUID(), input())
            val laterSaved = enquiries.page(0).items.first { it.number == later.number }
            assertEquals(0, pushRoutes.summary(laterSaved.id, true)!!.subscriptions)
        } finally {
            pushStorage.deactivate(sub, a.id)
            notificationSettings.update(
                notificationSettings
                    .get()
                    .copy(
                        telegramEnabled = settings.telegramEnabled,
                        browserPushEnabled = settings.browserPushEnabled,
                    )
            )
        }
    }

    @Test
    fun `expired push work is not delivered`() {
        val a = admin()
        val sub =
            pushStorage.save(
                UUID.randomUUID(),
                a.id,
                a.authVersion,
                pushRoutes.generationHash,
                UUID.randomUUID().toString().replace("-", ""),
                ru.lastochka.notifications.dto.PushSubscriptionInput(
                    "https://example.test/push",
                    "fake-key",
                    "fake-auth",
                ),
            )!!
        val settings = notificationSettings.get()
        val sender =
            org.mockito.Mockito.mock(ru.lastochka.notifications.service.PushSender::class.java)
        org.mockito.Mockito.`when`(sender.configured()).thenReturn(true)
        val queue =
            ru.lastochka.notifications.service.PushQueue(pushOutbox, sender, pushRoutes, accounts)
        val tx = org.springframework.transaction.support.TransactionTemplate(txManager)
        try {
            notificationSettings.update(
                settings.copy(telegramEnabled = false, browserPushEnabled = true)
            )
            val receipt = enquiries.submit(UUID.randomUUID(), input())
            val saved = enquiries.page(0).items.first { it.number == receipt.number }
            jdbc
                .sql(
                    "UPDATE browser_push_outbox SET created_at=now()-interval '2 days' WHERE enquiry_id=:id"
                )
                .param("id", saved.id)
                .update()
            assertNull(tx.execute { queue.claim() })
            assertEquals(1, pushRoutes.summary(saved.id, true)!!.failed)
            assertTrue(
                org.mockito.Mockito.mockingDetails(sender).invocations.none {
                    it.method.name == "send"
                }
            )
        } finally {
            pushStorage.deactivate(sub, a.id)
            notificationSettings.update(
                notificationSettings
                    .get()
                    .copy(
                        telegramEnabled = settings.telegramEnabled,
                        browserPushEnabled = settings.browserPushEnabled,
                    )
            )
        }
    }

    @Test
    fun `one failed push device does not prevent a second device delivery`() {
        val owner = admin()
        val settings = notificationSettings.get()
        val input =
            ru.lastochka.notifications.dto.PushSubscriptionInput(
                "https://example.test/push",
                "fake-key",
                "fake-auth",
            )
        val firstId =
            pushStorage.save(
                UUID.randomUUID(),
                owner.id,
                owner.authVersion,
                pushRoutes.generationHash,
                UUID.randomUUID().toString().replace("-", ""),
                input,
            )!!
        val secondId =
            pushStorage.save(
                UUID.randomUUID(),
                owner.id,
                owner.authVersion,
                pushRoutes.generationHash,
                UUID.randomUUID().toString().replace("-", ""),
                input,
            )!!
        val sender =
            org.mockito.Mockito.mock(ru.lastochka.notifications.service.PushSender::class.java)
        org.mockito.Mockito.`when`(sender.configured()).thenReturn(true)
        val queue =
            ru.lastochka.notifications.service.PushQueue(pushOutbox, sender, pushRoutes, accounts)
        val tx = org.springframework.transaction.support.TransactionTemplate(txManager)
        try {
            notificationSettings.update(
                settings.copy(telegramEnabled = false, browserPushEnabled = true)
            )
            val receipt = enquiries.submit(UUID.randomUUID(), input())
            val saved = enquiries.page(0).items.first { it.number == receipt.number }
            assertEquals(2, pushRoutes.summary(saved.id, true)!!.subscriptions)
            val first = tx.execute { queue.claim() }!!
            org.mockito.Mockito.`when`(sender.send(first)).thenReturn(410 to null)
            tx.executeWithoutResult { queue.deliver(first) }
            val second = tx.execute { queue.claim() }!!
            assertNotEquals(first.subscriptionId, second.subscriptionId)
            org.mockito.Mockito.`when`(sender.send(second)).thenReturn(201 to null)
            tx.executeWithoutResult { queue.deliver(second) }
            val summary = pushRoutes.summary(saved.id, true)!!
            assertEquals(1, summary.accepted)
            assertEquals(1, summary.failed)
        } finally {
            pushStorage.deactivate(firstId, owner.id)
            pushStorage.deactivate(secondId, owner.id)
            notificationSettings.update(
                notificationSettings
                    .get()
                    .copy(
                        telegramEnabled = settings.telegramEnabled,
                        browserPushEnabled = settings.browserPushEnabled,
                    )
            )
        }
    }

    @Test
    fun `push device status and deletion are isolated by admin identity`() {
        val owner = admin()
        val other = admin()
        val hash = UUID.randomUUID().toString().replace("-", "")
        val input =
            ru.lastochka.notifications.dto.PushSubscriptionInput(
                "https://example.test/push",
                "fake-key",
                "fake-auth",
            )
        val id =
            pushStorage.save(
                UUID.randomUUID(),
                owner.id,
                owner.authVersion,
                pushRoutes.generationHash,
                hash,
                input,
            )!!
        assertNull(
            pushStorage.save(
                UUID.randomUUID(),
                other.id,
                other.authVersion,
                pushRoutes.generationHash,
                hash,
                input,
            )
        )
        try {
            assertFalse(
                pushStorage.active(id, other.id, other.authVersion, pushRoutes.generationHash)
            )
            val guest = client()
            assertNotEquals(200, get(guest, "/api/v1/admin/browser-push/config").statusCode())
            val c = client()
            val initial = json.readTree(get(c, "/api/v1/auth/csrf").body()).path("token").asString()
            assertEquals(
                200,
                post(
                        c,
                        "/api/v1/auth/password-stage",
                        json.writeValueAsString(
                            mapOf("login" to other.login, "password" to "Test-pass-2026")
                        ),
                        initial,
                    )
                    .statusCode(),
            )
            val token = json.readTree(get(c, "/api/v1/auth/csrf").body()).path("token").asString()
            val route = "/api/v1/admin/browser-push/subscriptions/$id"
            assertFalse(json.readTree(get(c, route).body()).path("active").asBoolean())
            val withoutCsrf =
                HttpRequest.newBuilder(URI("http://localhost:$port/lastochka$route"))
                    .DELETE()
                    .build()
            assertEquals(
                403,
                c.send(withoutCsrf, HttpResponse.BodyHandlers.ofString()).statusCode(),
            )
            val delete =
                HttpRequest.newBuilder(URI("http://localhost:$port/lastochka$route"))
                    .header("X-CSRF-TOKEN", token)
                    .DELETE()
                    .build()
            assertEquals(200, c.send(delete, HttpResponse.BodyHandlers.ofString()).statusCode())
            assertTrue(
                pushStorage.active(id, owner.id, owner.authVersion, pushRoutes.generationHash)
            )
        } finally {
            pushStorage.deactivate(id, owner.id)
        }
    }

    @Test
    fun `new access generation retires restored pending subscriptions even when push is unconfigured`() {
        val admin = admin()
        val sub =
            pushStorage.save(
                UUID.randomUUID(),
                admin.id,
                admin.authVersion,
                pushRoutes.generationHash,
                UUID.randomUUID().toString().replace("-", ""),
                ru.lastochka.notifications.dto.PushSubscriptionInput(
                    "https://example.test/push",
                    "fake-key",
                    "fake-auth",
                ),
            )!!
        val settings = notificationSettings.get()
        val tx = org.springframework.transaction.support.TransactionTemplate(txManager)
        try {
            notificationSettings.update(
                settings.copy(telegramEnabled = false, browserPushEnabled = true)
            )
            val receipt = enquiries.submit(UUID.randomUUID(), input())
            val saved = enquiries.page(0).items.first { it.number == receipt.number }
            assertEquals(1, pushRoutes.summary(saved.id, true)!!.waiting)
            val restoredRoutes =
                ru.lastochka.notifications.service.NotificationRoutes(
                    pushRouteStorage,
                    accounts,
                    ru.lastochka.notifications.config.PushProperties(),
                    "fresh-external-generation-for-restore",
                )
            val sender =
                org.mockito.Mockito.mock(ru.lastochka.notifications.service.PushSender::class.java)
            org.mockito.Mockito.`when`(sender.configured()).thenReturn(false)
            val restoredQueue =
                ru.lastochka.notifications.service.PushQueue(
                    pushOutbox,
                    sender,
                    restoredRoutes,
                    accounts,
                )
            assertNull(tx.execute { restoredQueue.claim() })
            assertFalse(
                pushStorage.active(sub, admin.id, admin.authVersion, pushRoutes.generationHash)
            )
            assertEquals(1, restoredRoutes.summary(saved.id, false)!!.failed)
            assertTrue(
                org.mockito.Mockito.mockingDetails(sender).invocations.none {
                    it.method.name == "send"
                }
            )
        } finally {
            pushStorage.deactivate(sub, admin.id)
            notificationSettings.update(
                notificationSettings
                    .get()
                    .copy(
                        telegramEnabled = settings.telegramEnabled,
                        browserPushEnabled = settings.browserPushEnabled,
                    )
            )
        }
    }

    @Test
    fun `push addresses reject local private reserved and mapped networks`() {
        val safe = ru.lastochka.notifications.service.SafePushEndpoint()
        listOf(
                "127.0.0.1",
                "10.0.0.1",
                "100.64.1.1",
                "169.254.169.254",
                "172.16.1.1",
                "192.168.1.1",
                "192.0.2.1",
                "198.18.0.1",
                "::1",
                "fc00::1",
                "fe80::1",
                "2001:db8::1",
                "::ffff:127.0.0.1",
            )
            .forEach {
                assertFalse(safe.publicAddress(java.net.InetAddress.getByName(it)), it)
            }
        assertTrue(safe.publicAddress(java.net.InetAddress.getByName("8.8.8.8")))
        assertTrue(safe.publicAddress(java.net.InetAddress.getByName("2606:4700:4700::1111")))
        listOf(
                "http://example.com/push",
                "https://127.0.0.1/push",
                "https://localhost/push",
                "https://example.com:8080/push",
                "https://user@example.com/push",
            )
            .forEach {
                assertThrows<Exception> { safe.validate(it) }
            }
    }

    @Test
    fun `invalid fields do not create an enquiry or event`() {
        val n = count("enrollment_requests")
        val q = count("telegram_outbox")
        assertThrows<ru.lastochka.common.error.FieldValidationException> {
            enquiries.submit(UUID.randomUUID(), input().copy(phone = "bad"))
        }
        assertThrows<ru.lastochka.common.error.FieldValidationException> {
            enquiries.submit(UUID.randomUUID(), input().copy(childAge = 18))
        }
        assertThrows<ru.lastochka.common.error.FieldValidationException> {
            enquiries.submit(UUID.randomUUID(), input().copy(parentName = " "))
        }
        assertThrows<ru.lastochka.common.error.FieldValidationException> {
            enquiries.submit(UUID.randomUUID(), input().copy(comment = "a".repeat(1001)))
        }
        assertEquals(n, count("enrollment_requests"))
        assertEquals(q, count("telegram_outbox"))
    }

    @Test
    fun `same key concurrent requests create only one logical event`() {
        val key = UUID.randomUUID()
        val executor = java.util.concurrent.Executors.newFixedThreadPool(2)
        try {
            val results =
                (1..2)
                    .map {
                        executor.submit<ru.lastochka.enquiries.dto.EnquiryReceipt> {
                            enquiries.submit(key, input())
                        }
                    }
                    .map { it.get() }
            assertEquals(results[0], results[1])
        } finally {
            executor.shutdownNow()
        }
    }


    @Test
    fun `calendar cleanup retires its indexes and preserves payment and audit indexes`() {
        val retired = listOf("studio_sessions", "session_group_links", "session_edit_drafts",
            "schedule_groups", "session_series", "permanent_series", "permanent_series_revisions",
            "studio_sessions_start_idx", "session_group_links_group_idx", "session_series_group_idx",
            "session_series_age_direction_idx", "permanent_series_effective_start_idx",
            "permanent_series_revisions_period_idx")
        for (name in retired) {
            assertTrue(jdbc.sql("SELECT to_regclass(:name) IS NULL").param("name",name)
                .query(Boolean::class.java).single(), name)
        }
        val valid = jdbc.sql("""
            SELECT indexrelid::regclass::text FROM pg_index WHERE indisvalid AND indisready
              AND indexrelid::regclass::text IN ('recurrence_history_pkey','recurrence_history_aggregate_idx',
                  'payment_requests_created_id_idx','alfa_attempts_due_environment_idx')
            """).query(String::class.java).list()
        assertEquals(4,valid.size)
        val guarantees = jdbc.sql("""
            SELECT c.contype::text FROM pg_constraint c JOIN pg_index i ON i.indexrelid=c.conindid
            WHERE c.conrelid='weekly_intervals'::regclass AND c.contype IN ('p','x')
              AND i.indisvalid AND i.indisready ORDER BY 1
            """).query(String::class.java).list()
        assertEquals(listOf("p","x"),guarantees)
    }

    @Test
    fun `weekly commands protect the week boundary versions and enquiry snapshots`() {
        val actor = admin().id
        val age = UUID.fromString("b8c0a000-0000-4000-8000-000000000001")
        fun key() = UUID.randomUUID().toString()
        val sunday = WeeklySlotInput(0, age, 7, 1430, 30)
        val createKey = key()
        val slot = scheduling.save(actor, createKey, null, sunday)
        assertEquals(slot, scheduling.save(actor, createKey, null, sunday))
        assertThrows<ResponseStatusException> {
            scheduling.save(actor, key(), null, sunday.copy(weekday = 1, startMinute = 10))
        }
        val input = EnquiryInput("Тест", "+79001234567", contractVersion = 3,
            ageDirectionId = age, weeklyPreference = slot.reference)
        val enquiryKey = UUID.randomUUID()
        val receipt = enquiries.submit(enquiryKey, input)
        val snapshot = jdbc.sql("SELECT desired_session_snapshot FROM enrollment_requests WHERE public_number=:n")
            .param("n",receipt.number).query(String::class.java).single()
        assertTrue(snapshot.contains("23:50"))
        val id = slot.reference.seriesId
        val change = sunday.copy(expectedRevision = slot.reference.revision, weekday = 4, startMinute = 1080)
        val changed = scheduling.save(actor, key(), id, change)
        assertThrows<ResponseStatusException> { scheduling.save(actor, key(), id, change) }
        assertThrows<ResponseStatusException> { enquiries.submit(UUID.randomUUID(), input) }
        assertThrows<ResponseStatusException> { scheduling.withdraw(actor, key(), id, slot.reference.revision) }
        scheduling.withdraw(actor, key(), id, changed.reference.revision)
        assertFalse(scheduling.current().intervals.any { it.reference.seriesId == id })
        assertEquals(receipt, enquiries.submit(enquiryKey, input))
        assertEquals(snapshot, jdbc.sql("SELECT desired_session_snapshot FROM enrollment_requests WHERE public_number=:n")
            .param("n",receipt.number).query(String::class.java).single())
    }

    @Test
    fun `dated commands replay only when the old receipt exists`() {
        val id = UUID.randomUUID()
        val dated = input().copy(desiredSessionId=id, desiredSessionVersion=1)
        val key = UUID.randomUUID()
        val receipt = enquiries.submit(key,input())
        val oldBody = """{"parentName":"Родитель","phone":"+79001234567","childName":"Ребёнок","childAge":7,"desiredSessionId":"$id","desiredSessionVersion":1,"comment":"<b>Обычный текст</b>"}"""
        val hash = java.security.MessageDigest.getInstance("SHA-256").digest(oldBody.toByteArray()).joinToString("") { "%02x".format(it) }
        jdbc.sql("UPDATE enquiry_replays SET request_hash=:hash WHERE key=:key").param("hash",hash).param("key",key).update()
        val before = listOf("enrollment_requests","telegram_outbox","enquiry_replays").map(::count)
        assertEquals(receipt, enquiries.submit(key, dated))
        assertThrows<ResponseStatusException> { enquiries.submit(UUID.randomUUID(), dated) }
        assertEquals(before, listOf("enrollment_requests","telegram_outbox","enquiry_replays").map(::count))
    }

    @Test
    fun `draft payment preserves exact minor units and conflicts on stale edit`() {
        val a = admin()
        val p =
            payments.save(a.id, null, PaymentInput(12345, "Занятие", "Родитель", "+79001234567"))
        assertEquals(12345, payments.find(p.id).amountMinor)
        assertFalse(p.paymentLinkIssuanceAvailable)
        assertEquals("DRAFT", p.status)
        payments.save(
            a.id,
            p.id,
            PaymentInput(
                12346,
                "Новое назначение",
                "Родитель",
                "+79001234567",
                expectedVersion = p.version,
            ),
        )
        assertThrows<ResponseStatusException> {
            payments.save(
                a.id,
                p.id,
                PaymentInput(
                    12347,
                    "Конфликт",
                    "Родитель",
                    "+79001234567",
                    expectedVersion = p.version,
                ),
            )
        }
        val e = assertThrows<ResponseStatusException> { payments.issue(p.id) }
        assertEquals("PAYMENT_PROVIDER_NOT_CONFIGURED", e.reason)
        assertThrows<ru.lastochka.common.error.FieldValidationException> {
            payments.save(a.id, null, PaymentInput(0, "Занятие", "Родитель", "+79001234567"))
        }
    }

    @Test
    fun `retired Telegram history preserves a pending row without scheduling a send`() {
        val receipt = enquiries.submit(UUID.randomUUID(), input())
        val id = enquiries.page(0).items.first { it.number == receipt.number }.id
        assertEquals("NOT_SELECTED", telegram.view(id).status)
        jdbc.sql("INSERT INTO telegram_outbox(enquiry_id,body) VALUES(:id,'Synthetic history')")
            .param("id", id).update()
        try {
            val history = telegram.view(id)
            assertEquals(0, history.attempts)
            assertFalse(history.configured)
            assertEquals("STOPPED", history.status)
            assertEquals("PENDING", jdbc.sql("SELECT status FROM telegram_outbox WHERE enquiry_id=:id")
                .param("id", id).query(String::class.java).single())
        } finally {
            jdbc.sql("DELETE FROM telegram_outbox WHERE enquiry_id=:id").param("id", id).update()
        }
    }

    private fun client() =
        HttpClient.newBuilder()
            .cookieHandler(CookieManager(null, java.net.CookiePolicy.ACCEPT_ALL))
            .build()

    private fun get(c: HttpClient, path: String) =
        c.send(
            HttpRequest.newBuilder(URI("http://localhost:$port/lastochka$path")).GET().build(),
            HttpResponse.BodyHandlers.ofString(),
        )

    private fun post(
        c: HttpClient,
        path: String,
        body: String,
        csrf: String? = null,
    ): HttpResponse<String> {
        val b =
            HttpRequest.newBuilder(URI("http://localhost:$port/lastochka$path"))
                .header("Content-Type", "application/json")
        if (csrf != null) b.header("X-CSRF-TOKEN", csrf)
        return c.send(
            b.POST(HttpRequest.BodyPublishers.ofString(body)).build(),
            HttpResponse.BodyHandlers.ofString(),
        )
    }

    @Test
    fun `notification settings require admin and csrf`() {
        val path = "/api/v1/admin/enquiry-notification-settings"
        val guest = client()
        assertNotEquals(200, get(guest, path).statusCode())
        val a = admin()
        val adminClient = client()
        val csrf =
            json.readTree(get(adminClient, "/api/v1/auth/csrf").body()).path("token").asString()
        assertEquals(
            200,
            post(
                    adminClient,
                    "/api/v1/auth/password-stage",
                    json.writeValueAsString(
                        mapOf("login" to a.login, "password" to "Test-pass-2026")
                    ),
                    csrf,
                )
                .statusCode(),
        )
        val token =
            json.readTree(get(adminClient, "/api/v1/auth/csrf").body()).path("token").asString()
        val current = notificationSettings.get()
        val body = json.writeValueAsString(current)
        fun put(tokenValue: String?): HttpResponse<String> {
            val b =
                HttpRequest.newBuilder(URI("http://localhost:$port/lastochka$path"))
                    .header("Content-Type", "application/json")
            if (tokenValue != null) b.header("X-CSRF-TOKEN", tokenValue)
            return adminClient.send(
                b.PUT(HttpRequest.BodyPublishers.ofString(body)).build(),
                HttpResponse.BodyHandlers.ofString(),
            )
        }
        assertEquals(403, put(null).statusCode())
        assertEquals(200, put(token).statusCode())
        assertEquals(409, put(token).statusCode())
    }

    @Test
    fun `HTTP login is login-only and legacy registration is closed`() {
        val a = admin()
        val c = client()
        val token = json.readTree(get(c, "/api/v1/auth/csrf").body()).path("token").asString()
        val login =
            post(
                c,
                "/api/v1/auth/password-stage",
                json.writeValueAsString(mapOf("login" to a.login, "password" to "Test-pass-2026")),
                token,
            )
        assertEquals(200, login.statusCode(), login.body())
        assertFalse(json.readTree(login.body()).path("account").has("email"))
        val old = post(c, "/api/v1/auth/register", "{}", token)
        assertEquals(410, old.statusCode(), old.body())
        assertEquals(403, post(c, "/api/v1/admin/payment-requests", "{}").statusCode())
        access.reset(a.id, "Changed-123")
        assertNotEquals(200, get(c, "/api/v1/admin/enquiries").statusCode())
    }

    @Test
    fun `guest cannot read enquiries payments or families`() {
        val c = client()
        for (path in listOf("/api/v1/admin/enquiries", "/api/v1/admin/payment-requests")) {
            assertNotEquals(200, get(c, path).statusCode())
        }
        assertEquals(410, get(c, "/api/v1/bookings").statusCode())
        assertEquals(410, get(c, "/api/v1/public/booking-confirmation/bootstrap").statusCode())
    }

    @Test
    fun `new passwords and login attempts enforce their rules`() {
        val a = admin()
        assertThrows<ru.lastochka.common.error.FieldValidationException> {
            access.reset(a.id, "letters")
        }
        assertThrows<ResponseStatusException> { accounts.password(a.login!!, "wrong") }
        jdbc.sql("UPDATE accounts SET admin_enabled=false WHERE id=:id").param("id", a.id).update()
        assertThrows<ResponseStatusException> { accounts.password(a.login!!, "Test-pass-2026") }
    }

    private fun withVkSelected(action: () -> Unit) {
        jdbc.sql("UPDATE vk_enquiry_settings SET enabled=true,destination_id=:id WHERE id=1")
            .param("id", UUID.randomUUID()).update()
        try {
            action()
        } finally {
            jdbc.sql("UPDATE vk_enquiry_settings SET enabled=false,destination_id=NULL WHERE id=1").update()
        }
    }

    @Test
    fun `queue insert failure rolls back the enquiry transaction`() = withVkSelected {
        val n = count("enrollment_requests")
        jdbc
            .sql(
                "ALTER TABLE vk_enquiry_outbox ADD CONSTRAINT test_atomic_rejection CHECK(enquiry_number < 0) NOT VALID"
            )
            .update()
        try {
            assertThrows<org.springframework.dao.DataIntegrityViolationException> {
                enquiries.submit(UUID.randomUUID(), input().copy(comment = "reject-atomic"))
            }
        } finally {
            jdbc.sql("ALTER TABLE vk_enquiry_outbox DROP CONSTRAINT test_atomic_rejection").update()
        }
        assertEquals(n, count("enrollment_requests"))
    }


    @Test
    fun `HTTP rejects foreign origin oversized body and excessive login attempts`() {
        val c = client()
        val token = json.readTree(get(c, "/api/v1/auth/csrf").body()).path("token").asString()
        fun send(origin: String?, body: String): Int {
            val b =
                HttpRequest.newBuilder(URI("http://localhost:$port/lastochka/api/v1/enquiries"))
                    .header("Content-Type", "application/json")
                    .header("X-CSRF-TOKEN", token)
                    .header("Idempotency-Key", UUID.randomUUID().toString())
            if (origin != null) b.header("Origin", origin)
            return c.send(
                    b.POST(HttpRequest.BodyPublishers.ofString(body)).build(),
                    HttpResponse.BodyHandlers.ofString(),
                )
                .statusCode()
        }
        assertEquals(403, send("https://other.example", "{}"))
        assertEquals(413, send(null, "x".repeat(20000)))
        val a = admin()
        var last = 0
        repeat(11) {
            last =
                post(
                        c,
                        "/api/v1/auth/password-stage",
                        json.writeValueAsString(mapOf("login" to a.login, "password" to "wrong")),
                        token,
                    )
                    .statusCode()
        }
        assertEquals(429, last)
    }

    @Autowired lateinit var conceptStorage: ru.lastochka.identity.repo.ConceptRepository

    @Test
    fun `new runtime refuses a changed concept marker`() {
        jdbc.sql("UPDATE concept_state SET mode='INVALID' WHERE id=1").update()
        try {
            assertThrows<IllegalArgumentException> {
                ru.lastochka.identity.config.ConceptGuard(conceptStorage)
            }
        } finally {
            jdbc.sql("UPDATE concept_state SET mode='ADMIN_ENQUIRIES_V1' WHERE id=1").update()
        }
    }


    @Test
    fun `fractional age is rejected and null age remains absent at HTTP binding`() {
        val c = client()
        val token = json.readTree(get(c, "/api/v1/auth/csrf").body()).path("token").asString()
        for (age in listOf("7.5", "null")) {
            val body =
                """{"parentName":"Родитель","phone":"+79001234567","childName":"Ребёнок","childAge":$age}"""
            val request =
                HttpRequest.newBuilder(URI("http://localhost:$port/lastochka/api/v1/enquiries"))
                    .header("Content-Type", "application/json")
                    .header("X-CSRF-TOKEN", token)
                    .header("Idempotency-Key", UUID.randomUUID().toString())
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build()
            val response = c.send(request, HttpResponse.BodyHandlers.ofString())
            assertEquals(if (age == "null") 200 else 400, response.statusCode(), response.body())
        }
    }

    @Test
    fun `landing migration replaces only obsolete guest instructions`() {
        val text =
            jdbc
                .sql("SELECT payload::text FROM landing_content WHERE id=1")
                .query(String::class.java)
                .single()
        assertEquals(json.readTree(text), json.readTree(landing.publishedPayload()))
        assertFalse(text.contains("Создайте аккаунт родителя"))
        assertFalse(text.contains("Добавьте карточки детей в кабинете"))
        assertFalse(text.contains("Статус заявки виден в кабинете"))
        assertTrue(text.contains("Отправка заявки не резервирует место"))
        val hero = json.readTree(text).path("blocks").first { it.path("id").asString() == "hero" }
        assertEquals("Гимнастика для детей и взрослых", hero.path("title").asString())
    }
}
