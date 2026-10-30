package ru.lastochka.payments.controller

import java.util.UUID
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.*
import ru.lastochka.common.Metadata
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.payments.dto.PaymentInput
import ru.lastochka.payments.service.PaymentService

@RestController
class PaymentController(
    private val service: PaymentService,
    private val login: LoginSessionService,
) {
    @GetMapping(Metadata.Concept.ADMIN_PAYMENTS)
    fun list(@RequestParam(defaultValue = "0") page: Int) = service.page(page)

    @GetMapping(Metadata.Concept.ADMIN_PAYMENT_ID)
    fun one(@PathVariable id: UUID) = service.find(id)

    @PostMapping(Metadata.Concept.ADMIN_PAYMENTS)
    fun create(auth: Authentication, @RequestBody input: PaymentInput) =
        service.save(login.accountId(auth), null, input)

    @PutMapping(Metadata.Concept.ADMIN_PAYMENT_ID)
    fun update(auth: Authentication, @PathVariable id: UUID, @RequestBody input: PaymentInput) =
        service.save(login.accountId(auth), id, input)

    @PostMapping(Metadata.Concept.ADMIN_PAYMENT_ISSUE)
    fun issue(@PathVariable id: UUID): Nothing = service.issue(id)
}
