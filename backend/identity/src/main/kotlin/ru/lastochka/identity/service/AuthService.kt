package ru.lastochka.identity.service

import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.stereotype.Service
import org.springframework.web.bind.annotation.*
import ru.lastochka.common.Metadata
import ru.lastochka.common.dto.MessageResponse
import ru.lastochka.common.service.UserMessages
import ru.lastochka.identity.dto.*
import ru.lastochka.identity.service.*
import ru.lastochka.common.error.unauthorized
import ru.lastochka.common.service.CommandService
import ru.lastochka.identity.repo.SessionRevocationRepository
import ru.lastochka.identity.repo.UserPasswordRepository
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.core.Authentication
import org.springframework.transaction.annotation.Transactional

@Service
class AuthService(
    private val texts: UserMessages,
    private val accounts: AccountService,
    private val sessions: LoginSessionService,
    private val limiter: AuthRateLimiter,
    private val lifecycle: PasswordLifecycleService,
    private val commands: CommandService,
    private val storage: UserPasswordRepository,
    private val sessionStorage: SessionRevocationRepository,
    private val passwords: PasswordEncoder,
) {
    fun confirmation(req: HttpServletRequest, auth: Authentication?): PasswordConfirmationView {
        sessions.requireFull(req, auth)
        return PasswordConfirmationView(sessions.isFresh(req))
    }

    @Transactional
    fun confirm(input: ConfirmPasswordRequest, req: HttpServletRequest, auth: Authentication?): PasswordConfirmationView {
        val actor = sessions.requireFull(req, auth)
        limiter.check("password.confirm.ip/${req.remoteAddr}", Metadata.PasswordLifecycle.CHANGE_IP_LIMIT)
        limiter.check("password.confirm.account/${actor.id}", Metadata.PasswordLifecycle.CHANGE_ACCOUNT_LIMIT)
        commands.lockStudio()
        val locked = storage.lock(actor.id) ?: unauthorized(Metadata.ErrorCodes.AUTH_REQUIRED)
        val current = sessions.requireFull(req, auth)
        val session = req.getSession(false) ?: unauthorized(Metadata.ErrorCodes.AUTH_REQUIRED)
        if (locked.id != current.id || locked.authVersion != current.authVersion ||
            !locked.adminEnabled || locked.mustChangePassword ||
            locked.role !in setOf(Metadata.Identity.ADMIN, Metadata.StaffAccess.STAFF))
            unauthorized(Metadata.ErrorCodes.AUTH_REQUIRED)
        if (sessionStorage.lockActive(session.id, locked.email, System.currentTimeMillis()) == null)
            unauthorized(Metadata.ErrorCodes.AUTH_REQUIRED)
        if (!passwords.matches(input.password, locked.passwordHash))
            unauthorized(Metadata.ErrorCodes.INVALID_CREDENTIALS)
        sessions.markPasswordConfirmed(req)
        return PasswordConfirmationView(true)
    }

    fun password(
        input: PasswordRequest,
        req: HttpServletRequest,
        res: HttpServletResponse,
    ): AuthView {
        limiter.check(
            "${Metadata.Identity.RATE_LOGIN_IP_PREFIX}${req.remoteAddr}",
            Metadata.IdentityLimits.LOGIN_IP,
        )
        limiter.check(
            "${Metadata.Identity.RATE_LOGIN_PREFIX}${accounts.normalized(input.login)}",
            Metadata.IdentityLimits.LOGIN_ACCOUNT,
        )
        val a = accounts.password(input.login, input.password)
        sessions.save(a, false, req, res)
        return sessions.state(
            org.springframework.security.core.context.SecurityContextHolder.getContext()
                .authentication
        )
    }

    fun change(
        input: ChangePasswordRequest,
        req: HttpServletRequest,
        res: HttpServletResponse,
        auth: org.springframework.security.core.Authentication?,
    ): AuthView {
        val a = sessions.account(auth)
        limiter.check(
            "password.change.ip/${req.remoteAddr}",
            Metadata.PasswordLifecycle.CHANGE_IP_LIMIT,
        )
        limiter.check(
            "password.change.account/${a.id}",
            Metadata.PasswordLifecycle.CHANGE_ACCOUNT_LIMIT,
        )
        val version =
            (req.getSession(false)?.getAttribute(Metadata.Identity.AUTH_VERSION_ATTRIBUTE)
                    as? Number)
                ?.toLong()
                ?: ru.lastochka.common.error.unauthorized(Metadata.ErrorCodes.AUTH_REQUIRED)
        val updated = lifecycle.change(a.id, version, input)
        req.getSession(false)?.invalidate()
        org.springframework.security.web.csrf
            .HttpSessionCsrfTokenRepository()
            .saveToken(null, req, res)
        sessions.save(updated, false, req, res)
        return sessions.state(
            org.springframework.security.core.context.SecurityContextHolder.getContext()
                .authentication
        )
    }

    fun logout(req: HttpServletRequest): MessageResponse {
        req.getSession(false)?.invalidate()
        org.springframework.security.core.context.SecurityContextHolder.clearContext()
        return MessageResponse(texts.render(Metadata.UserTexts.SIGNED_OUT))
    }
}
