package ru.lastochka.scheduling.controller

import io.swagger.v3.oas.annotations.Operation
import java.util.UUID
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import ru.lastochka.common.Metadata
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.scheduling.dto.AgeDirectionUpdate
import ru.lastochka.scheduling.service.AgeDirectionService

@RestController
@RequestMapping(Metadata.PermanentSchedule.PUBLIC_DIRECTIONS)
class PublicAgeDirectionController(private val service: AgeDirectionService) {
    @Operation(operationId = "listPublicAgeDirections") @GetMapping fun list() = service.active()
}

@RestController
@RequestMapping(Metadata.PermanentSchedule.ADMIN_DIRECTIONS)
class AdminAgeDirectionController(
    private val service: AgeDirectionService,
    private val login: LoginSessionService,
) {
    @Operation(operationId = "listAdminAgeDirections") @GetMapping fun list() = service.all()

    @Operation(operationId = "createAgeDirection")
    @PostMapping
    fun create(
        auth: Authentication,
        @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @RequestBody input: AgeDirectionUpdate,
    ) = service.save(login.accountId(auth), null, key, input)

    @Operation(operationId = "updateAgeDirection")
    @PutMapping(Metadata.Recurrence.ID)
    fun update(
        auth: Authentication,
        @PathVariable id: UUID,
        @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @RequestBody input: AgeDirectionUpdate,
    ) = service.save(login.accountId(auth), id, key, input)
}
