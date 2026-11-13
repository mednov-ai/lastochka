package ru.lastochka.scheduling.service

import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.mock
import org.mockito.Mockito.`when`
import org.springframework.web.server.ResponseStatusException
import ru.lastochka.common.error.FieldValidationException
import ru.lastochka.common.error.MessageProvider
import ru.lastochka.common.service.CommandService
import ru.lastochka.scheduling.dto.ScheduleGroupInput
import ru.lastochka.scheduling.dto.ScheduleGroupView
import ru.lastochka.scheduling.dto.SeriesDraftInput
import ru.lastochka.scheduling.dto.SeriesRule
import ru.lastochka.scheduling.dto.SessionInput
import ru.lastochka.scheduling.dto.SessionSeriesView
import ru.lastochka.scheduling.dto.SessionView
import ru.lastochka.scheduling.repo.RecurrenceRepository
import ru.lastochka.scheduling.repo.SessionQueryRepository
import ru.lastochka.scheduling.repo.StudioSessionRepository
import tools.jackson.databind.json.JsonMapper

class OpenEndedAgeTest {
    private val service =
        SchedulingService(
            mock(StudioSessionRepository::class.java),
            mock(SessionQueryRepository::class.java),
            mock(CommandService::class.java),
            Clock.fixed(Instant.parse("2026-11-10T12:00:00Z"), java.time.ZoneOffset.UTC),
            mock(RecurrenceRepository::class.java),
            mock(PermanentScheduleConflicts::class.java),
            mock(ru.lastochka.scheduling.repo.PermanentScheduleRepository::class.java),
            mock(ru.lastochka.scheduling.repo.AgeDirectionRepository::class.java),
            mock(ru.lastochka.identity.service.ConceptStateService::class.java),
        )

    private val base =
        SessionInput(
            "Группа",
            "GROUP",
            Instant.parse("2026-11-11T12:00:00Z"),
            Instant.parse("2026-11-11T13:00:00Z"),
            8,
        )

    @Test
    fun `validates distinct missing closed and open ranges`() {
        service.validateSession(base)
        service.validateSession(base.copy(ageFrom = 8, ageTo = 9))
        service.validateSession(base.copy(ageFrom = 14, ageOpenEnded = true))
        assertThrows(FieldValidationException::class.java) {
            service.validateSession(base.copy(ageFrom = 14))
        }
        assertThrows(FieldValidationException::class.java) {
            service.validateSession(base.copy(ageOpenEnded = true))
        }
        assertThrows(FieldValidationException::class.java) {
            service.validateSession(base.copy(ageFrom = 14, ageTo = 17, ageOpenEnded = true))
        }
    }

    @Test
    fun `legacy client cannot edit open range even if it drops both age values`() {
        val current =
            SessionView(
                UUID.randomUUID(),
                "Группа",
                "GROUP",
                base.startsAt,
                base.endsAt,
                8,
                "OPEN",
                1,
                ageFrom = 14,
                ageOpenEnded = true,
            )
        assertEquals(
            409,
            assertThrows(ResponseStatusException::class.java) {
                    service.requireAgeCapability(current, base)
                }
                .statusCode
                .value(),
        )
        service.requireAgeCapability(current, base.copy(ageFrom = 14, ageOpenEnded = true))
        service.requireAgeCapability(current, base.copy(ageOpenEnded = false))
    }

    @Test
    fun `legacy command serialization retains original idempotency input`() {
        val json = JsonMapper.builder().build()
        val old = json.writeValueAsString(base)
        assertFalse(old.contains("ageOpenEnded"), old)
        assertTrue(
            json
                .writeValueAsString(base.copy(ageFrom = 14, ageOpenEnded = true))
                .contains("\"ageOpenEnded\":true")
        )
        assertFalse(
            json.writeValueAsString(ScheduleGroupInput("Группа", 8, 8, 9)).contains("ageOpenEnded")
        )
        val oldView =
            SessionView(
                UUID.randomUUID(),
                "Группа",
                "GROUP",
                base.startsAt,
                base.endsAt,
                8,
                "OPEN",
                1,
                ageFrom = 8,
                ageTo = 9,
            )
        assertFalse(json.writeValueAsString(oldView).contains("ageOpenEnded"))
        assertTrue(
            json
                .writeValueAsString(oldView.copy(ageFrom = 14, ageTo = null, ageOpenEnded = true))
                .contains("\"ageOpenEnded\":true")
        )
    }

    @Test
    fun `legacy series edit cannot discard open ended age`() {
        val store = mock(RecurrenceRepository::class.java)
        val groupId = UUID.randomUUID()
        val seriesId = UUID.randomUUID()
        val clock = Clock.fixed(Instant.parse("2026-11-10T12:00:00Z"), java.time.ZoneOffset.UTC)
        val recurring =
            RecurrenceService(
                store,
                mock(StudioSessionRepository::class.java),
                service,
                mock(CommandService::class.java),
                clock,
                JsonMapper.builder().build(),
                mock(MessageProvider::class.java),
                mock(ru.lastochka.scheduling.repo.PermanentScheduleRepository::class.java),
            )
        val group = ScheduleGroupInput("Группа", 8, 14, null, true)
        `when`(store.group(groupId)).thenReturn(ScheduleGroupView(groupId, 1, group))
        val rule =
            SeriesRule(
                LocalDate.parse("2026-11-16"),
                LocalDate.parse("2026-11-30"),
                listOf(1),
                LocalTime.of(18, 0),
                60,
                "Группа",
                8,
                14,
                null,
                true,
            )
        `when`(store.series(seriesId)).thenReturn(SessionSeriesView(seriesId, groupId, 1, rule))
        val legacy =
            SeriesDraftInput(
                groupId,
                expectedVersion = 1,
                rule = rule.copy(ageFrom = null, ageOpenEnded = null),
            )
        assertEquals(
            409,
            assertThrows(ResponseStatusException::class.java) {
                    recurring.preview(seriesId, legacy)
                }
                .statusCode
                .value(),
        )
        assertEquals(3, recurring.expand(rule).size)
    }
}
