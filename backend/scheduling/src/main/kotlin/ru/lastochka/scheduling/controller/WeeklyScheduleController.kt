package ru.lastochka.scheduling.controller

import java.util.UUID
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.*
import ru.lastochka.common.Metadata
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.scheduling.dto.WeeklySlotInput
import ru.lastochka.scheduling.service.WeeklyScheduleService

@RestController
class PublicWeeklyScheduleController(private val service: WeeklyScheduleService) {
    @GetMapping(Metadata.PermanentSchedule.PUBLIC_SCHEDULE + Metadata.PermanentSchedule.WEEKLY_PATH)
    fun weeklySchedule() = service.current()
}

@RestController
@RequestMapping(Metadata.PermanentSchedule.ADMIN_WEEKLY)
class AdminWeeklyScheduleController(private val service: WeeklyScheduleService, private val login: LoginSessionService) {
    @GetMapping
    fun adminWeeklySchedule() = service.current(admin = true)

    @PostMapping
    fun publishWeeklySlot(auth: Authentication, @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @RequestBody input: WeeklySlotInput) = service.save(login.accountId(auth), key, null, input)

    @PutMapping(Metadata.Recurrence.ID)
    fun updateWeeklySlot(auth: Authentication, @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @PathVariable id: UUID, @RequestBody input: WeeklySlotInput) = service.save(login.accountId(auth), key, id, input)

    @DeleteMapping(Metadata.Recurrence.ID)
    fun withdrawWeeklySlot(auth: Authentication, @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @PathVariable id: UUID, @RequestParam expectedRevision: Long) = service.withdraw(login.accountId(auth), key, id, expectedRevision)
}
