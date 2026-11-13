package ru.lastochka.scheduling.service

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class PermanentRuleCalendarTest {
    private val revision =
        PermanentRuleCalendar.Revision(
            LocalDate.parse("2030-01-01"),
            LocalDate.parse("2030-02-01"),
            1,
            LocalTime.parse("23:30"),
            90,
        )

    @Test
    fun `calculates a bounded Moscow period and respects exclusive revision boundaries`() {
        val items =
            PermanentRuleCalendar.occurrences(
                revision,
                LocalDate.parse("2030-01-01"),
                LocalDate.parse("2030-02-10"),
            )
        assertEquals(
            listOf("2030-01-07", "2030-01-14", "2030-01-21", "2030-01-28"),
            items.map { it.originalDate.toString() },
        )
        assertEquals(Instant.parse("2030-01-07T20:30:00Z"), items.first().startsAt)
        assertEquals(Instant.parse("2030-01-07T22:00:00Z"), items.first().endsAt)
        assertTrue(
            PermanentRuleCalendar.occurrences(
                    revision,
                    LocalDate.parse("2030-02-01"),
                    LocalDate.parse("2030-02-08"),
                )
                .isEmpty()
        )
    }

    @Test
    fun `future projection stays finite and rejects oversized ranges`() {
        val open = revision.copy(effectiveUntil = null)
        val dates =
            PermanentRuleCalendar.occurrences(
                open,
                LocalDate.parse("2099-06-01"),
                LocalDate.parse("2099-06-08"),
            )
        assertEquals(1, dates.size)
        assertThrows(IllegalArgumentException::class.java) {
            PermanentRuleCalendar.occurrences(
                open,
                LocalDate.parse("2099-01-01"),
                LocalDate.parse("2099-05-01"),
            )
        }
    }

    @Test
    fun `single interval conflicts honour exceptions and exclusive ends`() {
        val start = Instant.parse("2030-01-07T21:00:00Z")
        val end = Instant.parse("2030-01-07T22:30:00Z")
        assertEquals(
            LocalDate.parse("2030-01-07"),
            PermanentRuleCalendar.overlapping(revision, start, end, emptySet())?.originalDate,
        )
        assertNull(
            PermanentRuleCalendar.overlapping(
                revision,
                start,
                end,
                setOf(LocalDate.parse("2030-01-07")),
            )
        )
        assertNull(
            PermanentRuleCalendar.overlapping(
                revision,
                Instant.parse("2030-01-07T22:00:00Z"),
                Instant.parse("2030-01-07T23:00:00Z"),
                emptySet(),
            )
        )
    }

    @Test
    fun `incomplete conflict checks fail closed`() {
        val open = revision.copy(effectiveUntil = null)
        val first = LocalDate.parse("2030-01-07")
        val ignored = (0L until 256).map { first.plusWeeks(it) }.toSet()
        assertThrows(IllegalStateException::class.java) {
            PermanentRuleCalendar.overlapping(
                open,
                Instant.parse("2030-01-07T20:30:00Z"),
                Instant.parse("2040-01-01T00:00:00Z"),
                ignored,
            )
        }
    }

    @Test
    fun `repeated rules respect finite revisions and skip cancelled occurrences`() {
        val monday = revision.copy(effectiveUntil = null)
        val tuesday =
            monday.copy(weekday = 2, startTime = LocalTime.of(0, 30), durationMinutes = 30)
        val after = Instant.parse("2030-01-01T00:00:00Z")
        val first =
            PermanentRuleCalendar.overlapBetween(monday, tuesday, after, emptySet(), emptySet())!!
        assertEquals(LocalDate.parse("2030-01-07"), first.first.originalDate)
        val next =
            PermanentRuleCalendar.overlapBetween(
                monday,
                tuesday,
                after,
                setOf(first.first.originalDate),
                emptySet(),
            )!!
        assertEquals(LocalDate.parse("2030-01-14"), next.first.originalDate)
        val finite = tuesday.copy(effectiveUntil = LocalDate.parse("2030-01-09"))
        assertNull(
            PermanentRuleCalendar.overlapBetween(
                monday,
                finite,
                after,
                setOf(first.first.originalDate),
                emptySet(),
            )
        )
        val adjacent = tuesday.copy(startTime = LocalTime.of(1, 0))
        assertNull(
            PermanentRuleCalendar.overlapBetween(monday, adjacent, after, emptySet(), emptySet())
        )
    }
}
