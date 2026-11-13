package ru.lastochka.scheduling.service

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import ru.lastochka.scheduling.dto.SessionMembership
import ru.lastochka.scheduling.dto.SessionView

class PermanentScheduleProjectionTest {
    private val series = UUID.fromString("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    private val group = UUID.fromString("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
    private val movedId = UUID.fromString("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
    private val cancelledId = UUID.fromString("dddddddd-dddd-4ddd-8ddd-dddddddddddd")
    private val rule =
        PermanentScheduleProjection.Rule(
            series,
            7,
            PermanentRuleCalendar.Revision(
                LocalDate.parse("2030-01-01"),
                null,
                1,
                LocalTime.of(17, 0),
                60,
            ),
            "14+ лет",
            8,
            14,
            null,
            true,
        )
    private val from = Instant.parse("2030-01-06T21:00:00Z")
    private val to = Instant.parse("2030-01-28T21:00:00Z")
    private val now = Instant.parse("2030-01-01T00:00:00Z")

    @Test
    fun `historical plan is visible only in the administrative projection and respects exceptions`() {
        val later = Instant.parse("2030-02-01T00:00:00Z")
        val link = SessionMembership(cancelledId, group, "Группа", series, LocalDate.parse("2030-01-14"), true)
        val cancelled = SessionView(cancelledId, "Отменено", "GROUP", Instant.parse("2030-01-14T14:00:00Z"),
            Instant.parse("2030-01-14T15:00:00Z"), 8, "CANCELLED", 3)
        val public = PermanentScheduleProjection.calculate(from, to, later, false,
            listOf(rule), listOf(link), emptyList(), mapOf(cancelledId to cancelled))
        val admin = PermanentScheduleProjection.calculate(from, to, later, false,
            listOf(rule), listOf(link), emptyList(), mapOf(cancelledId to cancelled), true)
        assertTrue(public.isEmpty())
        assertEquals(listOf("2030-01-07", "2030-01-21", "2030-01-28"),
            admin.filterIsInstance<PermanentScheduleProjection.Calculated>().map { it.originalDate.toString() })
        assertFalse(admin.any { it is PermanentScheduleProjection.Real })
    }

    @Test
    fun `preserves moved and cancelled exceptions and returns distinct calculated identities`() {
        val links =
            listOf(
                SessionMembership(
                    movedId,
                    group,
                    "Группа",
                    series,
                    LocalDate.parse("2030-01-07"),
                    true,
                ),
                SessionMembership(
                    cancelledId,
                    group,
                    "Группа",
                    series,
                    LocalDate.parse("2030-01-14"),
                    true,
                ),
            )
        val moved =
            SessionView(
                movedId,
                "Перенесено",
                "GROUP",
                Instant.parse("2030-01-10T14:00:00Z"),
                Instant.parse("2030-01-10T15:00:00Z"),
                8,
                "OPEN",
                2,
            )
        val cancelled =
            SessionView(
                cancelledId,
                "Отменено",
                "GROUP",
                Instant.parse("2030-01-14T14:00:00Z"),
                Instant.parse("2030-01-14T15:00:00Z"),
                8,
                "CANCELLED",
                3,
            )
        val result =
            PermanentScheduleProjection.calculate(
                from,
                to,
                now,
                false,
                listOf(rule),
                links,
                listOf(moved, cancelled),
                listOf(moved, cancelled).associateBy { it.id },
            )
        assertEquals(3, result.size)
        assertEquals(movedId, (result.first() as PermanentScheduleProjection.Real).session.id)
        val projected = result.filterIsInstance<PermanentScheduleProjection.Calculated>()
        assertEquals(
            listOf("2030-01-21", "2030-01-28"),
            projected.map { it.originalDate.toString() },
        )
        assertTrue(
            projected.all { it.seriesId == series && it.seriesVersion == 7L && it.ageOpenEnded }
        )
    }

    @Test
    fun `overlapping versions and oversized ranges fail closed`() {
        assertThrows(IllegalStateException::class.java) {
            PermanentScheduleProjection.calculate(
                from,
                to,
                now,
                false,
                listOf(rule, rule),
                emptyList(),
                emptyList(),
                emptyMap(),
            )
        }
        assertThrows(IllegalArgumentException::class.java) {
            PermanentScheduleProjection.calculate(
                from,
                from.plusSeconds(94L * 86400),
                now,
                false,
                listOf(rule),
                emptyList(),
                emptyList(),
                emptyMap(),
            )
        }
    }

    @Test
    fun `inconsistent linked session cannot masquerade as an empty week`() {
        val link = SessionMembership(movedId, group, "Группа", series, LocalDate.parse("2030-01-07"), false)
        val draft = SessionView(movedId, "Черновик", "GROUP", Instant.parse("2030-01-07T14:00:00Z"), Instant.parse("2030-01-07T15:00:00Z"), 8, "DRAFT", 1)
        assertThrows(IllegalStateException::class.java) {
            PermanentScheduleProjection.calculate(from, to, now, false, listOf(rule), listOf(link), emptyList(), mapOf(movedId to draft))
        }
    }
}
