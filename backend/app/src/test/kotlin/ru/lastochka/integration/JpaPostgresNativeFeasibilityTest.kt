package ru.lastochka.integration

import jakarta.persistence.EntityManager
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.dao.EmptyResultDataAccessException
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.transaction.annotation.Transactional
import org.testcontainers.postgresql.PostgreSQLContainer
import ru.lastochka.content.repo.LandingContentRepository
import ru.lastochka.identity.repo.ConceptRepository
import ru.lastochka.identity.repo.SessionRevocationRepository

@ActiveProfiles("test")
@SpringBootTest(properties = ["lastochka.workers.enabled=false"])
class JpaPostgresNativeFeasibilityTest {
    companion object {
        private val db = PostgreSQLContainer("postgres:17.6-alpine").apply { start() }

        @JvmStatic
        @DynamicPropertySource
        fun database(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url") { db.jdbcUrl }
            registry.add("spring.datasource.username") { db.username }
            registry.add("spring.datasource.password") { db.password }
        }

        @JvmStatic @AfterAll fun stop() = db.stop()
    }

    @Autowired lateinit var entityManager: EntityManager
    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var landing: LandingContentRepository
    @Autowired lateinit var concept: ConceptRepository
    @Autowired lateinit var revocations: SessionRevocationRepository

    @Autowired lateinit var limits: ru.lastochka.identity.repo.RateLimitQueries
    @Autowired lateinit var transactions: org.springframework.transaction.PlatformTransactionManager

    @Autowired lateinit var challenges: ru.lastochka.identity.repo.ChallengeRepository

    @Autowired lateinit var accountLocks: ru.lastochka.identity.repo.AccountLockRepository

    @Autowired
    lateinit var notificationSettings:
        ru.lastochka.notifications.repo.NotificationSettingsRepository

    @Autowired lateinit var telegramStorage: ru.lastochka.notifications.repo.TelegramRepository

    @Autowired lateinit var pushStorage: ru.lastochka.notifications.repo.PushOutboxRepository

    @Autowired lateinit var paymentStorage: ru.lastochka.payments.repo.PaymentRepository

    @Autowired lateinit var sessionQueries: ru.lastochka.scheduling.repo.SessionQueryRepository

    @Autowired lateinit var enquiries: ru.lastochka.enquiries.repo.EnquiryRepository
    @Autowired lateinit var userStorage: ru.lastochka.identity.repo.UserPasswordRepository
    @Autowired lateinit var draftStorage: ru.lastochka.scheduling.repo.SessionDraftRepository
    @Autowired lateinit var recurrenceStorage: ru.lastochka.scheduling.repo.RecurrenceRepository

    @Test
    @Transactional
    fun `payment update without version remains a conflict`() {
        val actor = java.util.UUID.randomUUID()
        val id = java.util.UUID.randomUUID()
        jdbc
            .sql(
                "INSERT INTO accounts(id,email,name,password_hash,role) VALUES(:id,:email,'Fixture','x','ADMIN')"
            )
            .param("id", actor)
            .param("email", "$actor@fixture.test")
            .update()
        val input =
            ru.lastochka.payments.dto.PaymentInput(100, "Fixture", "Fixture", "+79001234567")
        assertEquals(1, paymentStorage.save(id, actor, input, true))
        assertEquals(0, paymentStorage.save(id, actor, input, false))
        assertEquals(0L, paymentStorage.find(id)!!.version)
    }

    @Test
    @Transactional
    fun `list and history queries retain fixed query counts`() {
        val stats =
            entityManager.entityManagerFactory
                .unwrap(org.hibernate.SessionFactory::class.java)
                .statistics
        val previous = stats.isStatisticsEnabled
        stats.isStatisticsEnabled = true
        try {
            fun check(expected: Long, block: () -> Unit) {
                stats.clear()
                block()
                assertEquals(expected, stats.prepareStatementCount)
            }
            check(2) { paymentStorage.page(0) }
            check(2) { enquiries.page(0) }
            check(2) {
                userStorage.list(0, 25)
                userStorage.count()
            }
            val missing = java.util.UUID.randomUUID()
            check(2) { draftStorage.history(missing, 0) }
            check(2) { recurrenceStorage.history(missing, 0) }
        } finally {
            stats.isStatisticsEnabled = previous
        }
    }

    @Test
    @Transactional
    fun `calendar query count stays constant as result grows`() {
        val start = java.time.Instant.parse("2044-01-01T10:00:00Z")
        val end = start.plusSeconds(3600)
        fun add(amount: Int) {
            repeat(amount) {
                jdbc
                    .sql(
                        "INSERT INTO studio_sessions(id,title,format,starts_at,ends_at,capacity,status) VALUES(:id,'Fixture','GROUP',:start,:end,10,'OPEN')"
                    )
                    .param("id", java.util.UUID.randomUUID())
                    .param("start", start.atOffset(java.time.ZoneOffset.UTC))
                    .param("end", end.atOffset(java.time.ZoneOffset.UTC))
                    .update()
            }
        }
        val stats =
            entityManager.entityManagerFactory
                .unwrap(org.hibernate.SessionFactory::class.java)
                .statistics
        val previouslyEnabled = stats.isStatisticsEnabled
        stats.isStatisticsEnabled = true
        try {
            add(5)
            stats.clear()
            assertEquals(
                5,
                sessionQueries.calendarIds(start.minusSeconds(1), end.plusSeconds(1)).size,
            )
            val small = stats.prepareStatementCount
            stats.clear()
            assertEquals(
                5,
                sessionQueries
                    .findPage(start.minusSeconds(1), end.plusSeconds(1), 0, 100, true)
                    .first
                    .size,
            )
            val smallPage = stats.prepareStatementCount
            add(45)
            stats.clear()
            assertEquals(
                50,
                sessionQueries.calendarIds(start.minusSeconds(1), end.plusSeconds(1)).size,
            )
            assertEquals(small, stats.prepareStatementCount)
            assertEquals(1L, small)
            stats.clear()
            assertEquals(
                50,
                sessionQueries
                    .findPage(start.minusSeconds(1), end.plusSeconds(1), 0, 100, true)
                    .first
                    .size,
            )
            assertEquals(smallPage, stats.prepareStatementCount)
            assertEquals(2L, smallPage)
        } finally {
            stats.isStatisticsEnabled = previouslyEnabled
        }
    }

    @Test
    @Transactional
    fun `payment pagination matches postgres ordering and counts`() {
        val actor = java.util.UUID.randomUUID()
        jdbc
            .sql(
                "INSERT INTO accounts(id,email,name,password_hash,role) VALUES(:id,:email,'Fixture','x','ADMIN')"
            )
            .param("id", actor)
            .param("email", "$actor@fixture.test")
            .update()
        repeat(25) {
            jdbc
                .sql(
                    "INSERT INTO payment_requests(id,amount_minor,purpose,recipient_name,phone,created_by) VALUES(:id,100,'Fixture','Fixture','+79001234567',:actor)"
                )
                .param("id", java.util.UUID.randomUUID())
                .param("actor", actor)
                .update()
        }
        val size = ru.lastochka.common.Metadata.Concept.PAGE_SIZE
        for (page in 0..3) {
            val expected =
                jdbc
                    .sql(
                        "SELECT id FROM payment_requests ORDER BY created_at DESC,id DESC LIMIT :size OFFSET :offset"
                    )
                    .param("size", size)
                    .param("offset", page * size)
                    .query(java.util.UUID::class.java)
                    .list()
            val actual = paymentStorage.page(page)
            assertEquals(expected, actual.items.map { it.id })
            assertEquals(25L, actual.total)
        }
    }

    @Test
    fun `two workers claim browser push once until lease expiry`() {
        val actor = java.util.UUID.randomUUID()
        val enquiry = java.util.UUID.randomUUID()
        val subscription = java.util.UUID.randomUUID()
        jdbc
            .sql(
                "INSERT INTO accounts(id,email,name,password_hash,role) VALUES(:id,:email,'Fixture','x','ADMIN')"
            )
            .param("id", actor)
            .param("email", "$actor@fixture.test")
            .update()
        jdbc
            .sql(
                "INSERT INTO enrollment_requests(id,parent_name,phone) VALUES(:id,'Fixture','+79001234567')"
            )
            .param("id", enquiry)
            .update()
        jdbc
            .sql(
                "INSERT INTO browser_push_subscriptions(id,account_id,endpoint_hash,endpoint,p256dh,auth_secret,generation_hash,auth_version) VALUES(:id,:actor,:hash,'https://example.test','key','auth','fixture',0)"
            )
            .param("id", subscription)
            .param("actor", actor)
            .param("hash", subscription.toString())
            .update()
        jdbc
            .sql(
                "INSERT INTO browser_push_outbox(enquiry_id,subscription_id) VALUES(:enquiry,:subscription)"
            )
            .param("enquiry", enquiry)
            .param("subscription", subscription)
            .update()
        val pool = java.util.concurrent.Executors.newFixedThreadPool(2)
        val gate = java.util.concurrent.CountDownLatch(1)
        try {
            val jobs =
                (1..2).map {
                    pool.submit(
                        java.util.concurrent.Callable {
                            gate.await()
                            pushStorage.claim("fixture")
                        }
                    )
                }
            gate.countDown()
            val claimed =
                jobs.map { it.get(30, java.util.concurrent.TimeUnit.SECONDS) }.filterNotNull()
            assertEquals(1, claimed.size)
            assertEquals(enquiry, claimed.single().enquiryId)
            assertEquals(1, claimed.single().attempts)
            assertEquals(null, pushStorage.claim("fixture"))
            jdbc
                .sql(
                    "UPDATE browser_push_outbox SET lease_until=now()-interval '1 second' WHERE enquiry_id=:id"
                )
                .param("id", enquiry)
                .update()
            assertEquals(2, pushStorage.claim("fixture")!!.attempts)
        } finally {
            pool.shutdownNow()
            jdbc
                .sql("DELETE FROM browser_push_outbox WHERE enquiry_id=:id")
                .param("id", enquiry)
                .update()
            jdbc
                .sql("DELETE FROM browser_push_subscriptions WHERE id=:id")
                .param("id", subscription)
                .update()
            jdbc.sql("DELETE FROM enrollment_requests WHERE id=:id").param("id", enquiry).update()
            jdbc.sql("DELETE FROM accounts WHERE id=:id").param("id", actor).update()
        }
    }

    @Test
    fun `two workers claim telegram once until lease expiry`() {
        val id = java.util.UUID.randomUUID()
        jdbc
            .sql(
                "INSERT INTO enrollment_requests(id,parent_name,phone) VALUES(:id,'Fixture','+79001234567')"
            )
            .param("id", id)
            .update()
        telegramStorage.enqueue(id, "fixture")
        val pool = java.util.concurrent.Executors.newFixedThreadPool(2)
        val gate = java.util.concurrent.CountDownLatch(1)
        try {
            val jobs =
                (1..2).map {
                    pool.submit(
                        java.util.concurrent.Callable {
                            gate.await()
                            telegramStorage.claim()
                        }
                    )
                }
            gate.countDown()
            val claimed =
                jobs.map { it.get(30, java.util.concurrent.TimeUnit.SECONDS) }.filterNotNull()
            assertEquals(1, claimed.size)
            assertEquals(id, claimed.single().enquiryId)
            assertEquals(1, claimed.single().attempts)
            assertEquals(null, telegramStorage.claim())
            jdbc
                .sql(
                    "UPDATE telegram_outbox SET lease_until=now()-interval '1 second' WHERE enquiry_id=:id"
                )
                .param("id", id)
                .update()
            assertEquals(2, telegramStorage.claim()!!.attempts)
        } finally {
            pool.shutdownNow()
            jdbc.sql("DELETE FROM telegram_outbox WHERE enquiry_id=:id").param("id", id).update()
            jdbc.sql("DELETE FROM enrollment_requests WHERE id=:id").param("id", id).update()
        }
    }

    @Test
    fun `settings snapshot retains shared row lock and version check`() {
        val pool = java.util.concurrent.Executors.newSingleThreadExecutor()
        val tx = org.springframework.transaction.support.TransactionTemplate(transactions)
        try {
            tx.execute {
                val current = notificationSettings.get(true)
                val blocked =
                    pool.submit(
                        java.util.concurrent.Callable {
                            try {
                                org.springframework.transaction.support
                                    .TransactionTemplate(transactions)
                                    .execute {
                                        jdbc.sql("SET LOCAL lock_timeout = '250ms'").update()
                                        jdbc
                                            .sql(
                                                "UPDATE enquiry_notification_settings SET version=version+1 WHERE id=1"
                                            )
                                            .update()
                                    }
                                false
                            } catch (_: org.springframework.dao.DataAccessException) {
                                true
                            }
                        }
                    )
                assertEquals(true, blocked.get(10, java.util.concurrent.TimeUnit.SECONDS))
                assertEquals(
                    false,
                    notificationSettings.update(current.copy(version = current.version + 1)),
                )
                assertEquals(true, notificationSettings.update(current))
                assertEquals(current.version + 1, notificationSettings.get().version)
                it.setRollbackOnly()
            }
        } finally {
            pool.shutdownNow()
        }
    }

    @Test
    fun `jpa account lock blocks concurrent database writer`() {
        val actor = java.util.UUID.randomUUID()
        jdbc
            .sql(
                "INSERT INTO accounts(id,email,name,password_hash,role) VALUES(:id,:email,'Fixture','x','ADMIN')"
            )
            .param("id", actor)
            .param("email", "$actor@fixture.test")
            .update()
        val pool = java.util.concurrent.Executors.newSingleThreadExecutor()
        try {
            org.springframework.transaction.support.TransactionTemplate(transactions).execute {
                assertEquals(actor, accountLocks.lock(actor))
                assertEquals(0L, accountLocks.authVersion(actor))
                val blocked =
                    pool.submit(
                        java.util.concurrent.Callable {
                            try {
                                org.springframework.transaction.support
                                    .TransactionTemplate(transactions)
                                    .execute {
                                        jdbc.sql("SET LOCAL lock_timeout = '250ms'").update()
                                        jdbc
                                            .sql("UPDATE accounts SET name='Other' WHERE id=:id")
                                            .param("id", actor)
                                            .update()
                                    }
                                false
                            } catch (_: org.springframework.dao.DataAccessException) {
                                true
                            }
                        }
                    )
                assertEquals(true, blocked.get(10, java.util.concurrent.TimeUnit.SECONDS))
            }
        } finally {
            pool.shutdownNow()
            jdbc.sql("DELETE FROM accounts WHERE id=:id").param("id", actor).update()
        }
    }

    @Test
    fun `challenge replacement and concurrent consumption are atomic`() {
        val actor = java.util.UUID.randomUUID()
        val sid = java.util.UUID.randomUUID().toString()
        jdbc
            .sql(
                "INSERT INTO accounts(id,email,name,password_hash,role) VALUES(:id,:email,'Fixture','x','ADMIN')"
            )
            .param("id", actor)
            .param("email", "$actor@fixture.test")
            .update()
        val tx = org.springframework.transaction.support.TransactionTemplate(transactions)
        val pool = java.util.concurrent.Executors.newFixedThreadPool(2)
        try {
            tx.execute { challenges.save(sid, actor, "CREATE", "old") }
            tx.execute { challenges.save(sid, actor, "CREATE", "new") }
            val jobs =
                (1..2).map {
                    pool.submit(
                        java.util.concurrent.Callable { tx.execute { challenges.consume(sid) } }
                    )
                }
            val values =
                jobs.map { it.get(30, java.util.concurrent.TimeUnit.SECONDS) }.filterNotNull()
            assertEquals(1, values.size)
            assertEquals("new", values.single().payload)
            assertEquals(actor, values.single().accountId)
            assertEquals("CREATE", values.single().kind)
        } finally {
            pool.shutdownNow()
            jdbc
                .sql("DELETE FROM webauthn_challenges WHERE session_id=:id")
                .param("id", sid)
                .update()
            jdbc.sql("DELETE FROM accounts WHERE id=:id").param("id", actor).update()
        }
    }

    @Test
    fun `native spring data counter is atomic and resets at boundary`() {
        val bucket = "fixture-" + java.util.UUID.randomUUID()
        val now = java.time.OffsetDateTime.parse("2026-10-30T10:00:00Z")
        val until = now.plusMinutes(1)
        val pool = java.util.concurrent.Executors.newFixedThreadPool(4)
        try {
            val futures =
                (1..20).map {
                    pool.submit(
                        java.util.concurrent.Callable {
                            org.springframework.transaction.support
                                .TransactionTemplate(transactions)
                                .execute {
                                    limits.increment(bucket, now, until)
                                }!!
                        }
                    )
                }
            assertEquals(
                (1..20).toSet(),
                futures.map { it.get(30, java.util.concurrent.TimeUnit.SECONDS) }.toSet(),
            )
            val reset =
                org.springframework.transaction.support.TransactionTemplate(transactions).execute {
                    limits.increment(bucket, until, until.plusMinutes(1))
                }
            assertEquals(1, reset)
        } finally {
            pool.shutdownNow()
            jdbc
                .sql("DELETE FROM auth_limits WHERE bucket=:bucket")
                .param("bucket", bucket)
                .update()
        }
    }

    @Test
    @Transactional
    fun `session revocation preserves selected session and other principal`() {
        val first = "10000000-0000-0000-0000-000000000001"
        val second = "10000000-0000-0000-0000-000000000002"
        val other = "10000000-0000-0000-0000-000000000003"
        for ((id, principal) in
            listOf(first to "fixture-a", second to "fixture-a", other to "fixture-b")) {
            jdbc
                .sql(
                    "INSERT INTO spring_session(primary_id, session_id, creation_time, last_access_time, max_inactive_interval, expiry_time, principal_name) VALUES (:id,:id,0,0,1800,1,:principal)"
                )
                .param("id", id)
                .param("principal", principal)
                .update()
        }
        jdbc
            .sql(
                "INSERT INTO spring_session_attributes(session_primary_id, attribute_name, attribute_bytes) VALUES (:id, 'fixture', decode('00','hex'))"
            )
            .param("id", second)
            .update()
        assertEquals(1, revocations.revokeSessions("fixture-a", first))
        assertEquals(
            1L,
            jdbc
                .sql("SELECT count(*) FROM spring_session WHERE session_id=:id")
                .param("id", first)
                .query(Long::class.java)
                .single(),
        )
        assertEquals(
            0L,
            jdbc
                .sql("SELECT count(*) FROM spring_session_attributes WHERE session_primary_id=:id")
                .param("id", second)
                .query(Long::class.java)
                .single(),
        )
        assertEquals(1, revocations.revokeSessions("fixture-a", null))
        assertEquals(
            1L,
            jdbc
                .sql("SELECT count(*) FROM spring_session WHERE session_id=:id")
                .param("id", other)
                .query(Long::class.java)
                .single(),
        )
    }

    @Test
    @Transactional
    fun `concept marker matches jdbc including missing row`() {
        val old =
            jdbc.sql("SELECT mode FROM concept_state WHERE id=1").query(String::class.java).single()
        assertEquals(old, concept.mode())
        jdbc.sql("DELETE FROM concept_state WHERE id=1").update()
        assertThrows(EmptyResultDataAccessException::class.java) {
            jdbc.sql("SELECT mode FROM concept_state WHERE id=1").query(String::class.java).single()
        }
        assertThrows(EmptyResultDataAccessException::class.java) { concept.mode() }
    }

    @Test
    @Transactional
    fun `missing landing payload reports the same error as jdbc`() {
        jdbc.sql("DELETE FROM landing_content WHERE id=1").update()
        assertThrows(EmptyResultDataAccessException::class.java) {
            jdbc
                .sql("SELECT payload::text FROM landing_content WHERE id=1")
                .query(String::class.java)
                .single()
        }
        assertThrows(EmptyResultDataAccessException::class.java) { landing.publishedPayload() }
    }

    @Test
    @Transactional
    fun `native returning and advisory lock on postgres`() {
        entityManager
            .createNativeQuery(
                "CREATE TEMP TABLE jpa_native_probe (id integer PRIMARY KEY, attempts integer NOT NULL) ON COMMIT DROP"
            )
            .executeUpdate()
        val upsert =
            "INSERT INTO jpa_native_probe(id, attempts) VALUES (:id, 1) ON CONFLICT(id) DO UPDATE SET attempts=jpa_native_probe.attempts+1 RETURNING attempts"
        assertEquals(
            1,
            (entityManager.createNativeQuery(upsert).setParameter("id", 1).singleResult as Number)
                .toInt(),
        )
        assertEquals(
            2,
            (entityManager.createNativeQuery(upsert).setParameter("id", 1).singleResult as Number)
                .toInt(),
        )
        entityManager
            .createNativeQuery("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))")
            .setParameter("key", "fixture")
            .singleResult
        val claim =
            """WITH candidate AS (SELECT id FROM jpa_native_probe ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
            UPDATE jpa_native_probe p SET attempts=p.attempts+1 FROM candidate c WHERE p.id=c.id RETURNING p.attempts"""
        assertEquals(3, (entityManager.createNativeQuery(claim).singleResult as Number).toInt())
        assertEquals(
            3,
            (entityManager
                    .createNativeQuery(
                        "DELETE FROM jpa_native_probe WHERE id=:id RETURNING attempts"
                    )
                    .setParameter("id", 1)
                    .singleResult as Number)
                .toInt(),
        )
    }
}
