package ru.lastochka.enquiries.controller

import jakarta.servlet.http.HttpServletRequest
import java.util.UUID
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.*
import ru.lastochka.common.Metadata
import ru.lastochka.enquiries.dto.EnquiryInput
import ru.lastochka.enquiries.service.EnquiryService
import ru.lastochka.identity.service.AuthRateLimiter
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.notifications.service.TelegramQueue

@RestController
class EnquiryController(
    private val service: EnquiryService,
    private val limiter: AuthRateLimiter,
    private val telegram: TelegramQueue,
    private val login: LoginSessionService,
) {
    @PostMapping(Metadata.Concept.PUBLIC_ENQUIRIES)
    fun submit(
        @RequestHeader(Metadata.Protocol.IDEMPOTENCY_KEY) key: UUID,
        @RequestBody input: EnquiryInput,
        req: HttpServletRequest,
    ): ru.lastochka.enquiries.dto.EnquiryReceipt {
        limiter.check("enquiry:" + req.remoteAddr, Metadata.Concept.ENQUIRY_RATE)
        return service.submit(key, input)
    }

    @GetMapping(Metadata.Concept.ADMIN_ENQUIRIES)
    fun list(@RequestParam(defaultValue = "0") page: Int) = service.page(page)

    @GetMapping(Metadata.Concept.ADMIN_ENQUIRY_ID)
    fun one(@PathVariable id: UUID) = service.find(id)

    @GetMapping(Metadata.Concept.ADMIN_DELIVERY)
    fun delivery(@PathVariable id: UUID) = telegram.view(service.find(id).id)

    @PostMapping(Metadata.Concept.ADMIN_DELIVERY_RETRY)
    fun retry(
        @PathVariable id: UUID,
        auth: Authentication,
    ): ru.lastochka.notifications.dto.DeliveryView {
        limiter.check("delivery-retry:" + id, Metadata.Concept.RETRY_RATE)
        return telegram.retry(service.find(id).id, login.accountId(auth))
    }
}
