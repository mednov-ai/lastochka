package ru.lastochka.scheduling.controller

import ru.lastochka.common.Metadata
import io.swagger.v3.oas.annotations.Operation
import java.time.Instant
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController
import ru.lastochka.scheduling.service.PermanentScheduleProjectionService

@RestController
@RequestMapping(Metadata.PermanentSchedule.PUBLIC_SCHEDULE)
class PublicScheduleProjectionController(private val service: PermanentScheduleProjectionService) {
    @Operation(operationId = "listScheduleOccurrences")
    @GetMapping
    fun list(
        @RequestParam from: Instant,
        @RequestParam to: Instant,
        @RequestParam(defaultValue = "0") page: Int,
        @RequestParam(defaultValue = "20") size: Int,
        @RequestParam(defaultValue = "false") selectable: Boolean,
    ) = service.page(from, to, page, size, selectable)
}
