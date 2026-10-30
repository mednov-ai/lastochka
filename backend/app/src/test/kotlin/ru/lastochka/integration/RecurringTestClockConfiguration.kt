package ru.lastochka.integration

import java.time.Clock
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.concurrent.atomic.AtomicReference
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Primary

@TestConfiguration
class RecurringTestClockConfiguration {
    companion object {
        val now = AtomicReference<Instant?>(null)
    }

    @Bean
    @Primary
    fun recurringTestClock(): Clock =
        object : Clock() {
            override fun getZone(): ZoneId = ZoneOffset.UTC

            override fun withZone(zone: ZoneId): Clock = Clock.fixed(instant(), zone)

            override fun instant(): Instant = now.get() ?: Instant.now()
        }
}
