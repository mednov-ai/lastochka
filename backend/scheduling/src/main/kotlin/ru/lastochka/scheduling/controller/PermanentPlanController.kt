package ru.lastochka.scheduling.controller

import io.swagger.v3.oas.annotations.Operation
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import ru.lastochka.common.Metadata
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.scheduling.dto.PermanentPlanInput
import ru.lastochka.scheduling.dto.PermanentPlanPublish
import ru.lastochka.scheduling.dto.ScheduleRuleReference
import ru.lastochka.scheduling.dto.PermanentRuleChange
import ru.lastochka.scheduling.dto.PermanentRuleChangePublish
import ru.lastochka.scheduling.dto.PermanentRuleStop
import ru.lastochka.scheduling.dto.PermanentStopPublish
import ru.lastochka.scheduling.service.PermanentPlanService

@RestController
@RequestMapping(Metadata.PermanentSchedule.ADMIN_SCHEDULE)
class PermanentPlanController(
    private val plans: PermanentPlanService,
    private val login: LoginSessionService,
) {
    @GetMapping
    @Operation(operationId = "listPermanentScheduleRules")
    fun list() = plans.list()

    @PostMapping(Metadata.Recurrence.PREVIEW)
    @Operation(operationId = "previewPermanentSchedulePlan")
    fun preview(@RequestBody input: PermanentPlanInput) = plans.preview(input)

    @PostMapping(Metadata.PermanentSchedule.PUBLISH)
    @Operation(operationId = "publishPermanentSchedulePlan")
    fun publish(auth: Authentication, @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @RequestBody input: PermanentPlanPublish) = plans.publish(login.accountId(auth), key, input)

    @PostMapping(Metadata.PermanentSchedule.OCCURRENCE)
    @Operation(operationId = "materializePermanentScheduleOccurrence")
    fun occurrence(auth: Authentication, @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @RequestBody input: ScheduleRuleReference) = plans.materialize(login.accountId(auth), key, input)

    @PostMapping(Metadata.PermanentSchedule.CHANGE_PREVIEW)
    @Operation(operationId = "previewPermanentScheduleChange")
    fun previewChange(@RequestBody input: PermanentRuleChange) = plans.previewChange(input)

    @PostMapping(Metadata.PermanentSchedule.CHANGE)
    @Operation(operationId = "publishPermanentScheduleChange")
    fun change(auth: Authentication, @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @RequestBody input: PermanentRuleChangePublish) = plans.change(login.accountId(auth), key, input)

    @PostMapping(Metadata.PermanentSchedule.STOP_PREVIEW)
    @Operation(operationId = "previewPermanentScheduleStop")
    fun previewStop(@RequestBody input: PermanentRuleStop) = plans.previewStop(input)

    @PostMapping(Metadata.PermanentSchedule.STOP)
    @Operation(operationId = "stopPermanentScheduleRule")
    fun stop(auth: Authentication, @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: String,
        @RequestBody input: PermanentStopPublish) = plans.stop(login.accountId(auth), key, input)
}
