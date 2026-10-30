package ru.lastochka.identity.service

import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import java.time.Clock
import java.time.Instant
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.Authentication
import org.springframework.security.core.authority.SimpleGrantedAuthority
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.security.web.context.HttpSessionSecurityContextRepository
import org.springframework.stereotype.Service
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.forbidden
import ru.lastochka.common.error.unauthorized
import ru.lastochka.identity.dto.AuthView
import ru.lastochka.identity.entity.Account

@Service
class LoginSessionService(
    private val accounts: AccountService,
    private val clock: Clock,
    @org.springframework.beans.factory.annotation.Value(Metadata.Concept.ACCESS_GENERATION)
    private val generation: String,
) {
    private val repository = HttpSessionSecurityContextRepository()

    fun accountId(auth: Authentication?): java.util.UUID = account(auth).id

    fun account(auth: Authentication?): Account {
        if (auth == null || auth.name == Metadata.Identity.ANONYMOUS_PRINCIPAL)
            unauthorized(Metadata.ErrorCodes.AUTH_REQUIRED)
        return accounts.find(auth.name) ?: unauthorized(Metadata.ErrorCodes.AUTH_REQUIRED)
    }

    fun save(a: Account, webAuthn: Boolean, req: HttpServletRequest, res: HttpServletResponse) {
        val session = req.getSession(true)
        if (a.mustChangePassword) {
            session.setAttribute(Metadata.PasswordLifecycle.STARTED_AT, clock.instant().toString())
            session.removeAttribute(Metadata.Identity.PASSWORD_AT_ATTRIBUTE)
            session.maxInactiveInterval = Metadata.PasswordLifecycle.SESSION_SECONDS.toInt()
        } else session.removeAttribute(Metadata.PasswordLifecycle.STARTED_AT)
        req.changeSessionId()
        if (!a.mustChangePassword)
            session.setAttribute(
                Metadata.Identity.PASSWORD_AT_ATTRIBUTE,
                clock.instant().toString(),
            )
        session.setAttribute(Metadata.Identity.AUTH_VERSION_ATTRIBUTE, a.authVersion)
        session.setAttribute(Metadata.Concept.GENERATION_ATTRIBUTE, generation)
        if (webAuthn)
            session.setAttribute(Metadata.Identity.FULL_AT_ATTRIBUTE, clock.instant().toString())
        else session.removeAttribute(Metadata.Identity.FULL_AT_ATTRIBUTE)
        val roles =
            (if (a.mustChangePassword) emptyList() else a.roleNames())
                .map { "${Metadata.Identity.ROLE_PREFIX}$it" }
                .toMutableList()
                .apply { if (!a.mustChangePassword) add(Metadata.Identity.FACTOR_PASSWORD) }
        if (webAuthn && !a.mustChangePassword) roles.add(Metadata.Identity.FACTOR_WEBAUTHN)
        val auth =
            UsernamePasswordAuthenticationToken.authenticated(
                a.email,
                null,
                roles.map(::SimpleGrantedAuthority),
            )
        val ctx = SecurityContextHolder.createEmptyContext()
        ctx.authentication = auth
        SecurityContextHolder.setContext(ctx)
        repository.saveContext(ctx, req, res)
    }

    fun requireStage(
        req: HttpServletRequest,
        auth: Authentication,
    ): Account {
        val a = account(auth)
        if (a.mustChangePassword) forbidden(Metadata.PasswordLifecycle.REQUIRED)
        if (!a.adminEnabled) forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
        val at = req.session.getAttribute(Metadata.Identity.PASSWORD_AT_ATTRIBUTE) as? String
        if (
            at == null ||
                Instant.parse(at).plusSeconds(Metadata.IdentityLimits.RECENT_PASSWORD_SECONDS) <=
                    clock.instant()
        )
            unauthorized(Metadata.ErrorCodes.REAUTH_REQUIRED)
        if (auth.authorities.none { it.authority == Metadata.Identity.FACTOR_PASSWORD })
            unauthorized(Metadata.ErrorCodes.REAUTH_REQUIRED)
        return a
    }

    fun state(auth: Authentication?): AuthView {
        if (auth == null || auth.name == Metadata.Identity.ANONYMOUS_PRINCIPAL)
            return AuthView(Metadata.Identity.ANONYMOUS, null)
        val a = account(auth)
        val state =
            if (!a.adminEnabled) Metadata.Identity.ANONYMOUS
            else if (a.mustChangePassword) Metadata.PasswordLifecycle.REQUIRED
            else if (auth.authorities.any { it.authority == Metadata.Identity.FACTOR_PASSWORD })
                Metadata.Identity.FULL
            else Metadata.Identity.ANONYMOUS
        return AuthView(state, accounts.view(a))
    }
}
