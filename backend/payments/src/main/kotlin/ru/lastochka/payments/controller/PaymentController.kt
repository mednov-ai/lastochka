package ru.lastochka.payments.controller

import java.util.UUID
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.*
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.conflict
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.payments.alfa.AlfaGatewayEnvironment
import ru.lastochka.payments.alfa.AlfaGatewaySelection
import ru.lastochka.payments.alfa.AlfaPaymentCompatibility
import ru.lastochka.payments.dto.PaymentInput
import ru.lastochka.payments.dto.PaymentCommand
import ru.lastochka.payments.dto.PaymentView
import ru.lastochka.payments.service.PaymentService
import ru.lastochka.payments.service.AlfaTestPaymentService
import ru.lastochka.payments.service.AlfaProductionPaymentService

@RestController
class PaymentController(
    private val service: PaymentService,
    private val login: LoginSessionService,
    private val alfa: AlfaTestPaymentService,
    private val production: AlfaProductionPaymentService,
    private val selection: AlfaGatewaySelection,
    private val compatibility: AlfaPaymentCompatibility,
) {
    private fun decorate(value: PaymentView): PaymentView = when (value.gatewayEnvironment) {
        Metadata.AlfaConnection.PRODUCTION_ENVIRONMENT -> production.decorate(value)
        Metadata.AlfaConnection.TEST_ENVIRONMENT -> alfa.decorate(value)
        null -> if (selection.productionSelected()) production.decorate(value) else alfa.decorate(value)
        else -> value.copy(paymentLinkIssuanceAvailable = false, canRefresh = false, canCancel = false, canArchive = false, linkAvailable = false)
    }

    @GetMapping(Metadata.Concept.ADMIN_PAYMENTS)
    fun list(@RequestHeader(name = "X-Lastochka-Payment-Contract", required = false) contract: String?,
             @RequestParam(defaultValue = "0") page: Int, @RequestParam(required = false) category: String?) =
        service.page(page, category).let {
            compatibility.requireCompatible(contract)
            it.copy(items = it.items.map(::decorate))
        }

    @GetMapping(Metadata.Concept.ADMIN_PAYMENT_ID)
    fun one(@RequestHeader(name = "X-Lastochka-Payment-Contract", required = false) contract: String?, @PathVariable id: UUID): PaymentView {
        compatibility.requireCompatible(contract)
        val value = service.find(id)
        if (value.gatewayEnvironment == Metadata.AlfaConnection.PRODUCTION_ENVIRONMENT) compatibility.requireProductionClient(contract)
        return decorate(value)
    }

    @PostMapping(Metadata.Concept.ADMIN_PAYMENTS)
    fun create(auth: Authentication, @RequestHeader(name = "X-Lastochka-Payment-Contract", required = false) contract: String?, @RequestBody input: PaymentInput): PaymentView {
        compatibility.requireCompatible(contract)
        return service.save(login.accountId(auth), null, input)
    }

    @PutMapping(Metadata.Concept.ADMIN_PAYMENT_ID)
    fun update(auth: Authentication, @RequestHeader(name = "X-Lastochka-Payment-Contract", required = false) contract: String?, @PathVariable id: UUID, @RequestBody input: PaymentInput): PaymentView {
        compatibility.requireCompatible(contract)
        return service.save(login.accountId(auth), id, input)
    }

    @PostMapping(Metadata.Concept.ADMIN_PAYMENT_ISSUE)
    fun issue(auth: Authentication, @RequestHeader(name = "X-Lastochka-Payment-Contract", required = false) contract: String?, @PathVariable id: UUID, @RequestBody(required = false) input: PaymentCommand?): PaymentView {
        compatibility.requireCompatible(contract)
        if (input == null) service.issue(id)
        return when (selection.currentEnvironment()) {
            AlfaGatewayEnvironment.TEST -> alfa.issue(login.accountId(auth), id, input.expectedVersion)
            AlfaGatewayEnvironment.PRODUCTION -> {
                compatibility.requireProductionClient(contract)
                production.issue(login.accountId(auth), id, input.expectedVersion)
            }
            else -> conflict(Metadata.Concept.PAYMENT_PROVIDER_NOT_CONFIGURED)
        }
    }

    @PostMapping(Metadata.AlfaPayment.REFRESH)
    fun refresh(auth: Authentication, @RequestHeader(name = "X-Lastochka-Payment-Contract", required = false) contract: String?, @PathVariable id: UUID, @RequestBody input: PaymentCommand): PaymentView {
        compatibility.requireCompatible(contract)
        return when (service.find(id).gatewayEnvironment) {
            Metadata.AlfaConnection.TEST_ENVIRONMENT -> alfa.refresh(login.accountId(auth), id, input.expectedVersion)
            Metadata.AlfaConnection.PRODUCTION_ENVIRONMENT -> { compatibility.requireProductionClient(contract); production.refresh(login.accountId(auth), id, input.expectedVersion) }
            else -> conflict(Metadata.Concept.PAYMENT_PROVIDER_NOT_CONFIGURED)
        }
    }

    @PostMapping(Metadata.AlfaPayment.CANCEL)
    fun cancel(auth: Authentication, @RequestHeader(name = "X-Lastochka-Payment-Contract", required = false) contract: String?, @PathVariable id: UUID, @RequestBody input: PaymentCommand): PaymentView {
        compatibility.requireCompatible(contract)
        return when (service.find(id).gatewayEnvironment) {
            Metadata.AlfaConnection.TEST_ENVIRONMENT -> alfa.cancel(login.accountId(auth), id, input.expectedVersion)
            Metadata.AlfaConnection.PRODUCTION_ENVIRONMENT -> { compatibility.requireProductionClient(contract); production.cancel(login.accountId(auth), id, input.expectedVersion) }
            else -> conflict(Metadata.Concept.PAYMENT_PROVIDER_NOT_CONFIGURED)
        }
    }

    @PostMapping(Metadata.AlfaPayment.ARCHIVE)
    fun archive(auth: Authentication, @RequestHeader(name = "X-Lastochka-Payment-Contract", required = false) contract: String?, @PathVariable id: UUID, @RequestBody input: PaymentCommand): PaymentView {
        compatibility.requireCompatible(contract)
        return when (service.find(id).gatewayEnvironment) {
            Metadata.AlfaConnection.TEST_ENVIRONMENT -> alfa.archive(login.accountId(auth), id, input.expectedVersion)
            Metadata.AlfaConnection.PRODUCTION_ENVIRONMENT -> { compatibility.requireProductionClient(contract); production.archive(login.accountId(auth), id, input.expectedVersion) }
            else -> conflict(Metadata.Concept.PAYMENT_PROVIDER_NOT_CONFIGURED)
        }
    }

    @PostMapping(Metadata.AlfaPayment.LINK)
    fun link(auth: Authentication, @RequestHeader(name = "X-Lastochka-Payment-Contract", required = false) contract: String?, @PathVariable id: UUID): ru.lastochka.payments.dto.PaymentLink {
        compatibility.requireCompatible(contract)
        return when (service.find(id).gatewayEnvironment) {
            Metadata.AlfaConnection.TEST_ENVIRONMENT -> alfa.link(login.accountId(auth), id)
            Metadata.AlfaConnection.PRODUCTION_ENVIRONMENT -> { compatibility.requireProductionClient(contract); production.link(login.accountId(auth), id) }
            else -> conflict(Metadata.Concept.PAYMENT_PROVIDER_NOT_CONFIGURED)
        }
    }
}
