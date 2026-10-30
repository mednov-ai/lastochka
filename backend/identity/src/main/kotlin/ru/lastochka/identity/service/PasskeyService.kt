package ru.lastochka.identity.service

import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.security.core.Authentication
import org.springframework.security.web.webauthn.api.*
import org.springframework.security.web.webauthn.management.*
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import ru.lastochka.common.Metadata
import ru.lastochka.common.dto.MessageResponse
import ru.lastochka.common.error.badRequest
import ru.lastochka.common.error.conflict
import ru.lastochka.common.error.notFound
import ru.lastochka.common.error.unauthorized
import ru.lastochka.common.service.UserMessages
import ru.lastochka.identity.dto.*
import ru.lastochka.identity.dto.AccountView
import ru.lastochka.identity.entity.Account
import ru.lastochka.identity.repo.AccountLockRepository
import ru.lastochka.identity.repo.CredentialRepository

@Service
class PasskeyService(
    private val sessionRevocation: ru.lastochka.identity.repo.SessionRevocationRepository,
    private val texts: UserMessages,
    private val credentials: CredentialRepository,
    private val relying: WebAuthnRelyingPartyOperations,
    private val sessions: LoginSessionService,
    private val challenges: ChallengeStore,
    private val locks: AccountLockRepository,
    private val codec: ChallengeCodec,
    private val commands: ru.lastochka.common.service.CommandService,
) {
    fun count(a: Account): Int =
        credentials.findUser(a.email)?.let { credentials.findByUserId(it.id).size } ?: 0

    private fun lock(a: Account) {
        locks.lock(a.id)
    }

    private fun registrationAccount(req: HttpServletRequest, auth: Authentication): Account {
        val a = sessions.account(auth)
        lock(a)
        val version = locks.authVersion(a.id)
        if (
            (req.session.getAttribute(Metadata.Identity.AUTH_VERSION_ATTRIBUTE) as? Number)
                ?.toLong() != version
        )
            unauthorized(Metadata.ErrorCodes.REAUTH_REQUIRED)
        return sessions.requireStage(req, auth)
    }

    @Transactional
    fun registrationOptions(
        req: HttpServletRequest,
        auth: Authentication,
    ): PublicKeyCredentialCreationOptions {
        commands.lockStudio()
        val a = registrationAccount(req, auth)
        val options =
            relying.createPublicKeyCredentialCreationOptions(
                ImmutablePublicKeyCredentialCreationOptionsRequest(auth)
            )
        challenges.save(req.session.id, a.id, Metadata.Identity.CREATE, codec.encode(options))
        return options
    }

    @Transactional
    fun register(
        req: HttpServletRequest,
        auth: Authentication,
        input: RegisterCredentialRequest,
    ): MessageResponse {
        commands.lockStudio()
        val a = registrationAccount(req, auth)
        val options =
            codec.decode(
                challenges.consume(req.session.id, a.id, Metadata.Identity.CREATE),
                PublicKeyCredentialCreationOptions::class.java,
            )
        try {
            relying.registerCredential(
                ImmutableRelyingPartyRegistrationRequest(
                    options,
                    RelyingPartyPublicKey(input.credential, input.label.trim()),
                )
            )
        } catch (_: RuntimeException) {
            badRequest(Metadata.ErrorCodes.INVALID_WEBAUTHN)
        }
        return MessageResponse(texts.render(Metadata.UserTexts.KEY_ADDED))
    }

    @Transactional
    fun authenticationOptions(
        req: HttpServletRequest,
        auth: Authentication,
    ): PublicKeyCredentialRequestOptions {
        commands.lockStudio()
        val a = sessions.requireStage(req, auth)
        if (count(a) == 0) conflict(Metadata.ErrorCodes.ENROLLMENT_REQUIRED)
        val options =
            relying.createCredentialRequestOptions(
                ImmutablePublicKeyCredentialRequestOptionsRequest(auth)
            )
        challenges.save(req.session.id, a.id, Metadata.Identity.GET, codec.encode(options))
        return options
    }

    @Transactional
    fun authenticate(
        req: HttpServletRequest,
        res: HttpServletResponse,
        auth: Authentication,
        input: AuthenticateCredentialRequest,
    ): AuthView {
        commands.lockStudio()
        val a = sessions.requireStage(req, auth)
        val options =
            codec.decode(
                challenges.consume(req.session.id, a.id, Metadata.Identity.GET),
                PublicKeyCredentialRequestOptions::class.java,
            )
        val user =
            try {
                relying.authenticate(RelyingPartyAuthenticationRequest(options, input.credential))
            } catch (_: RuntimeException) {
                unauthorized(Metadata.ErrorCodes.INVALID_WEBAUTHN)
            }
        if (user.name != a.email) unauthorized(Metadata.ErrorCodes.INVALID_WEBAUTHN)
        sessions.save(a, true, req, res)
        return AuthView(
            Metadata.Identity.FULL,
            AccountView(a.id, a.login.orEmpty(), a.name, a.role, a.roleNames()),
        )
    }

    @Transactional
    fun list(req: HttpServletRequest, auth: Authentication): List<CredentialView> {
        commands.lockStudio()
        val a = sessions.requireStage(req, auth)
        return credentials.findUser(a.email)?.let {
            credentials.findByUserId(it.id).map { c ->
                CredentialView(
                    c.credentialId.toBase64UrlString(),
                    c.label,
                    c.created.toString(),
                    c.lastUsed.toString(),
                )
            }
        } ?: emptyList()
    }

    @Transactional
    fun change(req: HttpServletRequest, auth: Authentication, id: String, label: String?) {
        commands.lockStudio()
        val a = sessions.requireStage(req, auth)
        lock(a)
        val owner = credentials.findUser(a.email) ?: notFound(Metadata.ErrorCodes.NOT_FOUND)
        val key =
            try {
                Bytes.fromBase64(id)
            } catch (_: Exception) {
                notFound(Metadata.ErrorCodes.NOT_FOUND)
            }
        val c = credentials.findByCredentialId(key) ?: notFound(Metadata.ErrorCodes.NOT_FOUND)
        if (c.userEntityUserId != owner.id) notFound(Metadata.ErrorCodes.NOT_FOUND)
        if (label == null) {
            if (credentials.findByUserId(owner.id).size <= 1)
                conflict(Metadata.ErrorCodes.LAST_PASSKEY)
            credentials.delete(key)
            a.authVersion++
            req.session.setAttribute(Metadata.Identity.AUTH_VERSION_ATTRIBUTE, a.authVersion)
            sessionRevocation.revokeSessions(a.email, req.session.id)
        } else
            credentials.save(
                ImmutableCredentialRecord.fromCredentialRecord(c).label(label.trim()).build()
            )
    }
}
