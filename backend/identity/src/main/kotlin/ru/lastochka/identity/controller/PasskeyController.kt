package ru.lastochka.identity.controller

import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import jakarta.validation.Valid
import org.springframework.security.core.Authentication
import org.springframework.security.web.webauthn.api.*
import org.springframework.web.bind.annotation.*
import ru.lastochka.common.Metadata
import ru.lastochka.common.dto.MessageResponse
import ru.lastochka.common.service.UserMessages
import ru.lastochka.identity.dto.*
import ru.lastochka.identity.service.PasskeyService

@RestController
@RequestMapping(Metadata.Routes.API_V1_AUTH_WEBAUTHN)
class PasskeyController(
    private val texts: UserMessages,
    private val passkeys: PasskeyService,
) {
    @PostMapping(Metadata.Routes.REGISTRATION_OPTIONS)
    fun registrationOptions(
        req: HttpServletRequest,
        auth: Authentication,
    ): PublicKeyCredentialCreationOptions = passkeys.registrationOptions(req, auth)

    @PostMapping(Metadata.Routes.REGISTRATION_FINISH)
    fun register(
        req: HttpServletRequest,
        auth: Authentication,
        @Valid @RequestBody input: RegisterCredentialRequest,
    ) = passkeys.register(req, auth, input)

    @PostMapping(Metadata.Routes.AUTHENTICATION_OPTIONS)
    fun authenticationOptions(
        req: HttpServletRequest,
        auth: Authentication,
    ): PublicKeyCredentialRequestOptions = passkeys.authenticationOptions(req, auth)

    @PostMapping(Metadata.Routes.AUTHENTICATION_FINISH)
    fun authenticate(
        req: HttpServletRequest,
        res: HttpServletResponse,
        auth: Authentication,
        @RequestBody input: AuthenticateCredentialRequest,
    ) = passkeys.authenticate(req, res, auth, input)

    @GetMapping(Metadata.Routes.CREDENTIALS)
    fun list(req: HttpServletRequest, auth: Authentication) = passkeys.list(req, auth)

    @PatchMapping(Metadata.Routes.CREDENTIALS_ID)
    fun rename(
        req: HttpServletRequest,
        auth: Authentication,
        @PathVariable id: String,
        @Valid @RequestBody input: CredentialLabelRequest,
    ): MessageResponse {
        passkeys.change(req, auth, id, input.label)
        return MessageResponse(texts.render(Metadata.UserTexts.KEY_RENAMED))
    }

    @DeleteMapping(Metadata.Routes.CREDENTIALS_ID)
    fun delete(
        req: HttpServletRequest,
        auth: Authentication,
        @PathVariable id: String,
    ): MessageResponse {
        passkeys.change(req, auth, id, null)
        return MessageResponse(texts.render(Metadata.UserTexts.KEY_REVOKED))
    }
}
