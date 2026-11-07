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
import ru.lastochka.payments.alfa.AlfaCandidateRequest
import ru.lastochka.payments.alfa.AlfaConfigView
import ru.lastochka.payments.alfa.AlfaKeyRotationRequest
import ru.lastochka.payments.alfa.AlfaConfigurationService

@RestController
@RequestMapping(Metadata.AlfaConnection.BASE)
class AlfaConfigurationController(
    private val service: AlfaConfigurationService,
    private val login: LoginSessionService,
) {
    @GetMapping
    fun view(auth: Authentication): AlfaConfigView {
        if (login.account(auth).role != Metadata.Identity.ADMIN) forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        return service.view()
    }

    @PostMapping(Metadata.AlfaConnection.CANDIDATE)
    fun candidate(auth: Authentication, req: HttpServletRequest, @RequestBody input: AlfaCandidateRequest): AlfaConfigView {
        val account = login.requireStage(req, auth)
        if (account.role != Metadata.Identity.ADMIN) forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        return service.candidate(account.id, input)
    }

    @PostMapping(Metadata.AlfaConnection.CHECK)
    fun check(auth: Authentication, req: HttpServletRequest): AlfaConfigView {
        val account = login.requireStage(req, auth)
        if (account.role != Metadata.Identity.ADMIN) forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        return service.checkCandidate(account.id)
    }

    @PostMapping(Metadata.AlfaConnection.DISABLE)
    fun disable(auth: Authentication, req: HttpServletRequest): AlfaConfigView {
        val account = login.requireStage(req, auth)
        if (account.role != Metadata.Identity.ADMIN) forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        return service.disable(account.id)
    }

    @PostMapping(Metadata.AlfaConnection.ROTATE)
    fun rotate(auth: Authentication, req: HttpServletRequest, @RequestBody input: AlfaKeyRotationRequest): AlfaConfigView {
        val account = login.requireStage(req, auth)
        if (account.role != Metadata.Identity.ADMIN) forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        return service.rotateKey(account.id, input.keyId)
    }
}
