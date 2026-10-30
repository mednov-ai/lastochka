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

@Service
class AuthService(
    private val texts: UserMessages,
    private val accounts: AccountService,
    private val sessions: LoginSessionService,
    private val limiter: AuthRateLimiter,
    private val lifecycle: PasswordLifecycleService,
) {
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
