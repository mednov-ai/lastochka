package ru.lastochka.scheduling.service

import ru.lastochka.common.Metadata
import java.time.Duration
import java.time.LocalTime

/** Half-open weekly intervals in studio local time, including the Sunday/Monday boundary. */
internal object WeeklyPatternConflicts {
    private const val DAYS_IN_WEEK = Metadata.PermanentSchedule.DAYS_PER_WEEK
    private val day = Duration.ofDays(1).toNanos()
    private val week = Duration.ofDays(Metadata.PermanentSchedule.WEEK_DAYS).toNanos()

    data class Pattern(val weekdays: Set<Int>, val start: LocalTime, val durationMinutes: Int) {
        init {
            require(weekdays.isNotEmpty() && weekdays.all { it in 1..DAYS_IN_WEEK })
            require(durationMinutes > 0)
        }
    }

    /**
     * Two indefinitely recurring patterns always eventually overlap if their weekly shapes overlap.
     */
    fun overlap(first: Pattern, second: Pattern): Boolean {
        if (first.durationMinutes >= Metadata.PermanentSchedule.MAX_DURATION_MINUTES || second.durationMinutes >= Metadata.PermanentSchedule.MAX_DURATION_MINUTES)
            return true
        val firstDuration = Duration.ofMinutes(first.durationMinutes.toLong()).toNanos()
        val secondDuration = Duration.ofMinutes(second.durationMinutes.toLong()).toNanos()
        for (aDay in first.weekdays) {
            val a = (aDay - 1) * day + first.start.toNanoOfDay()
            for (bDay in second.weekdays) {
                val b = (bDay - 1) * day + second.start.toNanoOfDay()
                for (shift in -1L..1L) {
                    val shifted = b + shift * week
                    if (a < shifted + secondDuration && shifted < a + firstDuration) return true
                }
            }
        }
        return false
    }
}
