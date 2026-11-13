package ru.lastochka.scheduling.service

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class PermanentSchedulePlanTest {
    private val start = LocalDate.parse("2030-01-01")
    private val now = Instant.parse("2029-12-31T00:00:00Z")

    private fun slot(day: Int, time: String, minutes: Int = 60) =
        PermanentSchedulePlan.Slot(day, LocalTime.parse(time), minutes)

    @Test
    fun `multiple weekdays have independent times and complete bounded previews`() {
        val plan =
            PermanentSchedulePlan.preview(
                start,
                listOf(slot(1, "17:00"), slot(6, "11:00")),
                now,
                emptyList(),
                emptyList(),
            )
        assertEquals(listOf(4, 4), plan.samples.map { it.size })
        assertTrue(plan.conflicts.isEmpty())
    }

    @Test
    fun `one direction can have two distinct times on the same weekday`() {
        val plan = PermanentSchedulePlan.preview(start,
            listOf(slot(1, "10:00", 45), slot(1, "11:30", 60)), now, emptyList(), emptyList())
        assertTrue(plan.conflicts.isEmpty())
        assertEquals(4, plan.samples[0].size)
        assertEquals(4, plan.samples[1].size)
        assertNotEquals(plan.samples[0].first().startsAt, plan.samples[1].first().startsAt)
    }

    @Test
    fun `retained exception does not conflict with its own suppressed regular occurrence`() {
        val date = LocalDate.parse("2030-01-07")
        val moved = PermanentSchedulePlan.BusyInterval(
            Instant.parse("2030-01-07T14:00:00Z"), Instant.parse("2030-01-07T15:00:00Z"))
        val plan = PermanentSchedulePlan.preview(start, listOf(slot(1, "17:00")), now,
            emptyList(), listOf(moved), skippedProposed = setOf(date))
        assertTrue(plan.conflicts.isEmpty())
        assertFalse(plan.samples.single().any { it.originalDate == date })
    }

    @Test
    fun `one conflicting slot blocks the entire plan including a distant one-off event`() {
        val busy =
            PermanentSchedulePlan.BusyInterval(
                Instant.parse("2040-01-09T14:30:00Z"),
                Instant.parse("2040-01-09T15:00:00Z"),
            )
        val plan =
            PermanentSchedulePlan.preview(
                start,
                listOf(slot(1, "17:00"), slot(6, "11:00")),
                now,
                emptyList(),
                listOf(busy),
            )
        assertEquals(listOf(0), plan.conflicts.map { it.slot }.distinct())
        assertEquals("SESSION", plan.conflicts.single().source)
    }

    @Test
    fun `checks other weekly rules and cross-midnight slots`() {
        val other = PermanentRuleCalendar.Revision(start, null, 2, LocalTime.of(0, 30), 30)
        val plan =
            PermanentSchedulePlan.preview(
                start,
                listOf(slot(1, "23:30", 90), slot(6, "11:00")),
                now,
                listOf(PermanentSchedulePlan.KnownRule(other, emptySet())),
                emptyList(),
            )
        assertEquals("RULE", plan.conflicts.single().source)
        assertEquals(0, plan.conflicts.single().slot)
        val self =
            PermanentSchedulePlan.preview(
                start,
                listOf(slot(1, "23:30", 90), slot(2, "00:30")),
                now,
                emptyList(),
                emptyList(),
            )
        assertEquals("PLAN", self.conflicts.single().source)
    }

    @Test
    fun `resource limits fail closed instead of returning a partial plan`() {
        val same =
            PermanentSchedulePlan.BusyInterval(
                Instant.parse("2040-01-09T14:30:00Z"),
                Instant.parse("2040-01-09T15:00:00Z"),
            )
        assertThrows(IllegalStateException::class.java) {
            PermanentSchedulePlan.preview(
                start,
                List(30) { slot(1, "17:00") },
                now,
                emptyList(),
                List(2000) { same },
            )
        }
    }
}
