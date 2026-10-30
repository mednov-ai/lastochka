package ru.lastochka.scheduling.controller

import jakarta.validation.Valid
import java.time.Instant
import java.util.UUID
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.*
import ru.lastochka.common.Metadata
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.scheduling.dto.*
import ru.lastochka.scheduling.service.SchedulingService

@RestController
@RequestMapping(Metadata.Routes.API_V1)
class SessionController(
    private val sessions: SchedulingService,
    private val login: LoginSessionService,
) {
    @GetMapping(Metadata.Routes.SESSIONS)
    fun list(
        @RequestParam from: Instant,
        @RequestParam to: Instant,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") size: Int,
        @RequestParam(defaultValue = "false") selectable: Boolean,
    ) = sessions.list(from, to, page, size, false, selectable)

    @GetMapping(Metadata.Routes.SESSIONS_ID)
    fun one(@PathVariable id: UUID): SessionView = sessions.findPublishedSession(id)

    @GetMapping(Metadata.Routes.ADMIN_SESSIONS)
    fun admin(
        @RequestParam from: Instant,
        @RequestParam to: Instant,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") size: Int,
    ) = sessions.list(from, to, page, size, true)

    @GetMapping(Metadata.Routes.ADMIN_CALENDAR)
    fun calendar(@RequestParam from: Instant, @RequestParam to: Instant) =
        sessions.calendar(from, to)

    @PostMapping(Metadata.Routes.ADMIN_SESSIONS)
    fun create(
        auth: Authentication,
        @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @Valid @RequestBody input: SessionInput,
    ) = sessions.create(login.accountId(auth), key, input)

    @PutMapping(Metadata.Routes.ADMIN_SESSIONS_ID)
    fun update(
        auth: Authentication,
        @PathVariable id: UUID,
        @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @Valid @RequestBody input: SessionUpdate,
    ) = sessions.update(login.accountId(auth), id, key, input)

    @PostMapping(Metadata.Routes.ADMIN_SESSIONS_ID_ACTIONS)
    fun action(
        auth: Authentication,
        @PathVariable id: UUID,
        @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @Valid @RequestBody input: SessionAction,
    ) = sessions.applySessionAction(login.accountId(auth), id, key, input)
}
