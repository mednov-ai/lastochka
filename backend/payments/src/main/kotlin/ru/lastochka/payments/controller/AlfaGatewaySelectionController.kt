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
import ru.lastochka.payments.alfa.AlfaGatewaySelection
import ru.lastochka.payments.alfa.AlfaGatewaySelectionRequest
import ru.lastochka.payments.alfa.AlfaGatewaySelectionView

@RestController
@RequestMapping(Metadata.AlfaConnection.GATEWAY_SELECTION)
class AlfaGatewaySelectionController(private val selection: AlfaGatewaySelection, private val login: LoginSessionService) {
    @GetMapping
    fun view(auth: Authentication): AlfaGatewaySelectionView {
        if (login.account(auth).role != Metadata.Identity.ADMIN) forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        return selection.view()
    }

    @PostMapping
    fun select(auth: Authentication, req: HttpServletRequest, @RequestBody input: AlfaGatewaySelectionRequest): AlfaGatewaySelectionView {
        val actor = login.requireStage(req, auth)
        if (actor.role != Metadata.Identity.ADMIN) forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        return selection.select(actor.id, input)
    }
}
