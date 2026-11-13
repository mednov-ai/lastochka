package ru.lastochka.payments.controller

import jakarta.servlet.http.HttpServletRequest
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.forbidden
import ru.lastochka.identity.service.LoginSessionService
import ru.lastochka.payments.alfa.AlfaProductionCandidateRequest
import ru.lastochka.payments.alfa.AlfaKeyRotationRequest
import ru.lastochka.payments.alfa.AlfaProductionConfigurationService

@RestController
@RequestMapping(Metadata.AlfaConnection.PRODUCTION_BASE)
class AlfaProductionConfigurationController(
    private val service: AlfaProductionConfigurationService,
    private val login: LoginSessionService,
) {
    @GetMapping
    fun view(auth: Authentication): ru.lastochka.payments.alfa.AlfaProductionConfigView {
        if (login.account(auth).role != Metadata.Identity.ADMIN) forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        return service.view()
    }

    @PostMapping(Metadata.AlfaConnection.CANDIDATE)
    fun candidate(auth: Authentication, req: HttpServletRequest, @RequestBody input: AlfaProductionCandidateRequest): ru.lastochka.payments.alfa.AlfaProductionConfigView {
        val actor = login.requireStage(req, auth)
        if (actor.role != Metadata.Identity.ADMIN) forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        return service.candidate(actor.id, input)
    }

    @PostMapping(Metadata.AlfaConnection.CHECK)
    fun check(auth: Authentication, req: HttpServletRequest): ru.lastochka.payments.alfa.AlfaProductionConfigView {
        val actor = login.requireStage(req, auth)
        if (actor.role != Metadata.Identity.ADMIN) forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        return service.checkCandidate(actor.id)
    }

    @PostMapping(Metadata.AlfaConnection.DISABLE)
    fun disable(auth: Authentication, req: HttpServletRequest): ru.lastochka.payments.alfa.AlfaProductionConfigView {
        val actor = login.requireStage(req, auth)
        if (actor.role != Metadata.Identity.ADMIN) forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        return service.disable(actor.id)
    }
    @PostMapping(Metadata.AlfaConnection.ROTATE)
    fun rotate(auth: Authentication, req: HttpServletRequest, @RequestBody input: AlfaKeyRotationRequest): ru.lastochka.payments.alfa.AlfaProductionConfigView {
        val actor = login.requireStage(req, auth)
        if (actor.role != Metadata.Identity.ADMIN) forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        return service.rotateKey(actor.id, input.keyId)
    }
}
