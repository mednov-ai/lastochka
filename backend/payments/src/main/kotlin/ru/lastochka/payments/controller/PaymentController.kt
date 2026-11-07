package ru.lastochka.payments.controller

import java.util.UUID
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.*
import ru.lastochka.common.Metadata
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.payments.dto.PaymentInput
import ru.lastochka.payments.dto.PaymentCommand
import ru.lastochka.payments.service.PaymentService
import ru.lastochka.payments.service.AlfaTestPaymentService

@RestController
class PaymentController(
    private val service: PaymentService,
    private val login: LoginSessionService,
    private val alfa: AlfaTestPaymentService,
) {
    @GetMapping(Metadata.Concept.ADMIN_PAYMENTS)
    fun list(@RequestParam(defaultValue = "0") page: Int, @RequestParam(required = false) category: String?) =
        service.page(page, category).let { it.copy(items = it.items.map(alfa::decorate)) }

    @GetMapping(Metadata.Concept.ADMIN_PAYMENT_ID)
    fun one(@PathVariable id: UUID) = alfa.decorate(service.find(id))

    @PostMapping(Metadata.Concept.ADMIN_PAYMENTS)
    fun create(auth: Authentication, @RequestBody input: PaymentInput) =
        service.save(login.accountId(auth), null, input)

    @PutMapping(Metadata.Concept.ADMIN_PAYMENT_ID)
    fun update(auth: Authentication, @PathVariable id: UUID, @RequestBody input: PaymentInput) =
        service.save(login.accountId(auth), id, input)

    @PostMapping(Metadata.Concept.ADMIN_PAYMENT_ISSUE)
    fun issue(auth: Authentication, @PathVariable id: UUID, @RequestBody(required = false) input: PaymentCommand?) =
        if (input == null) service.issue(id) else alfa.issue(login.accountId(auth), id, input.expectedVersion)

    @PostMapping(Metadata.AlfaPayment.REFRESH)
    fun refresh(auth: Authentication, @PathVariable id: UUID, @RequestBody input: PaymentCommand) =
        alfa.refresh(login.accountId(auth), id, input.expectedVersion)

    @PostMapping(Metadata.AlfaPayment.CANCEL)
    fun cancel(auth: Authentication, @PathVariable id: UUID, @RequestBody input: PaymentCommand) =
        alfa.cancel(login.accountId(auth), id, input.expectedVersion)

    @PostMapping(Metadata.AlfaPayment.ARCHIVE)
    fun archive(auth: Authentication, @PathVariable id: UUID, @RequestBody input: PaymentCommand) =
        alfa.archive(login.accountId(auth), id, input.expectedVersion)

    @PostMapping(Metadata.AlfaPayment.LINK)
    fun link(auth: Authentication, @PathVariable id: UUID) = alfa.link(login.accountId(auth), id)
}
