package ru.lastochka.integration

import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.UUID
import org.junit.jupiter.api.AfterAll
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.test.context.ActiveProfiles
import org.springframework.test.context.DynamicPropertyRegistry
import org.springframework.test.context.DynamicPropertySource
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import org.testcontainers.postgresql.PostgreSQLContainer
import ru.lastochka.scheduling.repo.PermanentScheduleRepository

@ActiveProfiles("test")
@SpringBootTest(properties = ["lastochka.workers.enabled=false", "lastochka.schedule-extension.enabled=true",
    "lastochka.schedule-extension.initial-delay-ms=100", "lastochka.schedule-extension.delay-ms=250"])
class PermanentExtensionWorkerIntegrationTest {
    companion object {
        private val db = PostgreSQLContainer("postgres:17.6-alpine").apply { start() }
        @JvmStatic @DynamicPropertySource fun properties(registry: DynamicPropertyRegistry) {
            registry.add("spring.datasource.url") { db.jdbcUrl }
            registry.add("spring.datasource.username") { db.username }
            registry.add("spring.datasource.password") { db.password }
        }
        @JvmStatic @AfterAll fun stop() = db.stop()
    }
    @Autowired lateinit var jdbc: JdbcClient
    @Autowired lateinit var permanent: PermanentScheduleRepository
    @Autowired lateinit var txManager: PlatformTransactionManager

    @Test
    fun `scheduled extension recovers a backlog with unrelated workers disabled`() {
        val group = UUID.randomUUID()
        val series = UUID.randomUUID()
        val direction = UUID.fromString("b8c0a000-0000-4000-8000-000000000003")
        val first = LocalDate.now(ZoneId.of("Europe/Moscow")).plusDays(7)
        val notificationBefore = jdbc.sql("SELECT count(*) FROM telegram_outbox").query(Int::class.java).single()
        val paymentBefore = jdbc.sql("SELECT count(*) FROM payment_requests").query(Int::class.java).single()
        TransactionTemplate(txManager).executeWithoutResult {
            jdbc.sql("INSERT INTO schedule_groups(id,parameters) VALUES(:id,CAST('{\"name\":\"Автоматическое продление\"}' AS jsonb))").param("id", group).update()
            jdbc.sql("INSERT INTO session_series(id,group_id,age_direction_id) VALUES(:id,:groupId,:direction)").param("id", series).param("groupId", group).param("direction", direction).update()
            permanent.addPermanentSeries(series)
            permanent.advanceRevision(series, 0)
            permanent.addRevision(series, 1, first, first.plusDays(28), first.dayOfWeek.value,
                LocalTime.of(12, 0), 60, direction, "8–9 лет", 8, 8, 9, false)
            jdbc.sql("UPDATE concept_state SET mode='PERMANENT_SCHEDULE_V1' WHERE id=1").update()
        }
        try {
            fun count() = jdbc.sql("SELECT count(*) FROM session_group_links WHERE series_id=:id")
                .param("id", series).query(Int::class.java).single()
            val deadline = System.nanoTime() + 15_000_000_000L
            while (count() < 4 && System.nanoTime() < deadline) Thread.sleep(100)
            assertEquals(4, count(), "scheduled extension did not complete")
            Thread.sleep(700)
            assertEquals(4, count())
            assertEquals(notificationBefore, jdbc.sql("SELECT count(*) FROM telegram_outbox").query(Int::class.java).single())
            assertEquals(paymentBefore, jdbc.sql("SELECT count(*) FROM payment_requests").query(Int::class.java).single())
        } finally {
            jdbc.sql("UPDATE concept_state SET mode='ADMIN_ENQUIRIES_V1' WHERE id=1").update()
        }
    }
}
