package ru.lastochka.identity.controller

import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import jakarta.validation.Valid
import org.springframework.security.core.Authentication
import org.springframework.security.web.csrf.CsrfToken
import org.springframework.web.bind.annotation.*
import ru.lastochka.common.Metadata
import ru.lastochka.common.dto.MessageResponse
import ru.lastochka.identity.dto.*
import ru.lastochka.identity.service.*
import ru.lastochka.identity.service.AuthService

@RestController
@RequestMapping(Metadata.Routes.API_V1_AUTH)
class AuthController(
    private val service: AuthService,
    private val sessions: LoginSessionService,
) {
    @GetMapping(Metadata.Routes.CSRF)
    fun csrf(
        @io.swagger.v3.oas.annotations.Parameter(hidden = true) token: CsrfToken
    ): CsrfResponse = CsrfResponse(token.headerName, token.parameterName, token.token)

    @GetMapping(Metadata.Routes.ME) fun me(auth: Authentication?): AuthView = sessions.state(auth)

    @PostMapping(Metadata.Routes.PASSWORD_STAGE)
    fun password(
        @Valid @RequestBody input: PasswordRequest,
        req: HttpServletRequest,
        res: HttpServletResponse,
    ): AuthView = service.password(input, req, res)

    @PostMapping(Metadata.PasswordLifecycle.CHANGE_SUFFIX)
    fun change(
        @Valid @RequestBody input: ChangePasswordRequest,
        req: HttpServletRequest,
        res: HttpServletResponse,
        auth: Authentication?,
    ): AuthView = service.change(input, req, res, auth)

    @PostMapping(Metadata.Routes.LOGOUT)
    fun logout(req: HttpServletRequest): MessageResponse = service.logout(req)
}
