package ru.lastochka.scheduling.controller

import jakarta.validation.Valid
import java.time.Instant
import java.util.UUID
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.*
import ru.lastochka.common.Metadata
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.scheduling.dto.*
import ru.lastochka.scheduling.service.RecurrenceService

@RestController
@RequestMapping(Metadata.Recurrence.GROUPS)
class ScheduleGroupController(
    private val service: RecurrenceService,
    private val login: LoginSessionService,
) {
    @GetMapping fun list() = service.groups()

    @PostMapping
    fun create(
        auth: Authentication,
        @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @Valid @RequestBody input: ScheduleGroupUpdate,
    ) = service.saveGroup(login.accountId(auth), null, key, input)

    @PutMapping(Metadata.Recurrence.ID)
    fun update(
        auth: Authentication,
        @PathVariable id: UUID,
        @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @Valid @RequestBody input: ScheduleGroupUpdate,
    ) = service.saveGroup(login.accountId(auth), id, key, input)

    @GetMapping(Metadata.Recurrence.HISTORY)
    fun history(@PathVariable id: UUID, @RequestParam(defaultValue = "0") page: Int) =
        service.history(id, page)
}

@RestController
@RequestMapping(Metadata.Recurrence.SERIES)
class SessionSeriesController(
    private val service: RecurrenceService,
    private val login: LoginSessionService,
) {
    @GetMapping fun list() = service.list()

    @GetMapping(Metadata.Recurrence.ID) fun read(@PathVariable id: UUID) = service.read(id)

    @GetMapping(Metadata.Recurrence.CALENDAR)
    fun calendar(@RequestParam from: Instant, @RequestParam to: Instant) =
        service.calendar(from, to)

    @GetMapping(Metadata.Recurrence.HISTORY)
    fun history(@PathVariable id: UUID, @RequestParam(defaultValue = "0") page: Int) =
        service.history(id, page)

    @PostMapping(Metadata.Recurrence.PREVIEW)
    fun preview(@Valid @RequestBody input: SeriesDraftInput) = service.preview(null, input)

    @PostMapping(Metadata.Recurrence.NEW_GROUP_PREVIEW)
    fun previewNewGroup(@Valid @RequestBody input: NewGroupSeriesInput) =
        service.previewNewGroup(input)

    @PostMapping(Metadata.Recurrence.NEW_GROUP)
    fun createWithGroup(
        auth: Authentication,
        @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @Valid @RequestBody input: NewGroupSeriesInput,
    ) = service.saveWithNewGroup(login.accountId(auth), key, input)

    @PostMapping(Metadata.Recurrence.EXISTING_PREVIEW)
    fun previewExisting(@PathVariable id: UUID, @Valid @RequestBody input: SeriesDraftInput) =
        service.preview(id, input)

    @PostMapping
    fun create(
        auth: Authentication,
        @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @Valid @RequestBody input: SeriesDraftInput,
    ) = service.save(login.accountId(auth), null, key, input)

    @PutMapping(Metadata.Recurrence.DRAFT)
    fun save(
        auth: Authentication,
        @PathVariable id: UUID,
        @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @Valid @RequestBody input: SeriesDraftInput,
    ) = service.save(login.accountId(auth), id, key, input)

    @DeleteMapping(Metadata.Recurrence.DRAFT)
    fun discard(
        auth: Authentication,
        @PathVariable id: UUID,
        @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @RequestBody input: SeriesCommand,
    ) = service.discard(login.accountId(auth), id, key, input)

    @PostMapping(Metadata.Recurrence.PUBLISH)
    fun publish(
        auth: Authentication,
        @PathVariable id: UUID,
        @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @RequestBody input: SeriesCommand,
    ) = service.publish(login.accountId(auth), id, key, input)
}
