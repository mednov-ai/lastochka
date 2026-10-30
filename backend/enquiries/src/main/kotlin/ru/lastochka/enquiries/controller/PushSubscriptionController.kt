package ru.lastochka.enquiries.controller

import java.util.UUID
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.*
import ru.lastochka.common.Metadata
import ru.lastochka.enquiries.service.EnquiryService
import ru.lastochka.identity.service.AuthRateLimiter
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.notifications.dto.PushSubscriptionInput
import ru.lastochka.notifications.service.NotificationRoutes
import ru.lastochka.notifications.service.PushSender
import ru.lastochka.notifications.service.PushSubscriptions

@RestController
class PushSubscriptionController(
    private val push: PushSubscriptions,
    private val sessions: LoginSessionService,
    private val limiter: AuthRateLimiter,
    private val routes: NotificationRoutes,
    private val sender: PushSender,
    private val enquiries: EnquiryService,
) {
    @GetMapping(Metadata.Concept.PUSH_SUMMARY)
    fun summary(@PathVariable id: UUID) = routes.summary(enquiries.find(id).id, sender.configured())

    @GetMapping(Metadata.Concept.PUSH_CONFIG) fun configuration() = push.configuration()

    @PostMapping(Metadata.Concept.PUSH_SUBSCRIPTIONS)
    fun subscribe(
        auth: Authentication,
        @RequestBody input: PushSubscriptionInput,
    ): ru.lastochka.notifications.dto.PushSubscriptionView {
        val account = sessions.account(auth)
        limiter.check("push-subscription:" + account.id, Metadata.BrowserPush.SUBSCRIPTION_RATE)
        return push.subscribe(account.id, account.authVersion, input)
    }

    @GetMapping(Metadata.Concept.PUSH_SUBSCRIPTION_ID)
    fun status(
        auth: Authentication,
        @PathVariable id: UUID,
    ): ru.lastochka.notifications.dto.PushSubscriptionStatus {
        val account = sessions.account(auth)
        return push.status(account.id, account.authVersion, id)
    }

    @DeleteMapping(Metadata.Concept.PUSH_SUBSCRIPTION_ID)
    fun unsubscribe(auth: Authentication, @PathVariable id: UUID) =
        push.unsubscribe(sessions.accountId(auth), id)
}
