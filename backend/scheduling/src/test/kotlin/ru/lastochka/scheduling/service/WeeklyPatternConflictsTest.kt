package ru.lastochka.scheduling.service

import java.time.LocalTime
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class WeeklyPatternConflictsTest {
    private fun pattern(day: Int, time: String, minutes: Int) =
        WeeklyPatternConflicts.Pattern(setOf(day), LocalTime.parse(time), minutes)

    @Test
    fun `detects overlaps across midnight and week boundary but allows touching endpoints`() {
        val sunday = pattern(7, "23:30", 90)
        assertTrue(WeeklyPatternConflicts.overlap(sunday, pattern(1, "00:30", 30)))
        assertTrue(WeeklyPatternConflicts.overlap(pattern(1, "00:30", 30), sunday))
        assertFalse(WeeklyPatternConflicts.overlap(sunday, pattern(1, "01:00", 60)))
        assertFalse(WeeklyPatternConflicts.overlap(sunday, pattern(7, "22:30", 60)))
        assertTrue(
            WeeklyPatternConflicts.overlap(
                pattern(2, "17:00", 60),
                pattern(2, "17:59:59.999999999", 1),
            )
        )
    }

    @Test
    fun `handles multi-day and full-week intervals without integer overflow`() {
        assertTrue(
            WeeklyPatternConflicts.overlap(pattern(1, "12:00", 3 * 24 * 60), pattern(4, "11:59", 1))
        )
        assertFalse(
            WeeklyPatternConflicts.overlap(pattern(1, "12:00", 3 * 24 * 60), pattern(4, "12:00", 1))
        )
        assertTrue(
            WeeklyPatternConflicts.overlap(
                pattern(1, "00:00", Int.MAX_VALUE),
                pattern(4, "12:00", 1),
            )
        )
    }

    @Test
    fun `rejects empty or invalid weekly rules`() {
        assertThrows(IllegalArgumentException::class.java) {
            WeeklyPatternConflicts.Pattern(emptySet(), LocalTime.NOON, 60)
        }
        assertThrows(IllegalArgumentException::class.java) { pattern(8, "12:00", 60) }
        assertThrows(IllegalArgumentException::class.java) { pattern(1, "12:00", 0) }
    }
}
