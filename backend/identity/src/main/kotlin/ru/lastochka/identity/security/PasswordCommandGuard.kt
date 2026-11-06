package ru.lastochka.identity.security

import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.stereotype.Component
import org.springframework.web.context.request.RequestContextHolder
import org.springframework.web.context.request.ServletRequestAttributes
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.forbidden
import ru.lastochka.common.error.unauthorized
import ru.lastochka.common.service.CommandAccessGuard
import ru.lastochka.identity.repo.UserPasswordRepository
import ru.lastochka.identity.service.StaffAccessService

@Component
class PasswordCommandGuard(
    private val storage: UserPasswordRepository,
    private val access: StaffAccessService,
) : CommandAccessGuard {
    override fun check() {
        val req =
            (RequestContextHolder.getRequestAttributes() as? ServletRequestAttributes)?.request
                ?: return
        val auth = SecurityContextHolder.getContext().authentication ?: return
        if (auth.name == Metadata.Identity.ANONYMOUS_PRINCIPAL) return
        val a = storage.findPrincipal(auth.name) ?: unauthorized(Metadata.ErrorCodes.AUTH_REQUIRED)
        val revision =
            (req.getSession(false)?.getAttribute(Metadata.Identity.AUTH_VERSION_ATTRIBUTE)
                    as? Number)
                ?.toLong()
        if (revision != a.authVersion || !a.adminEnabled ||
            a.role !in setOf(Metadata.Identity.ADMIN, Metadata.StaffAccess.STAFF))
            unauthorized(Metadata.ErrorCodes.AUTH_REQUIRED)
        val path = req.requestURI.removePrefix(req.contextPath)
        if (a.mustChangePassword && path != Metadata.PasswordLifecycle.CHANGE)
            forbidden(Metadata.PasswordLifecycle.REQUIRED)
        if (path.startsWith("/api/v1/admin/") && !access.allows(a, req.method, path))
            forbidden(Metadata.ErrorCodes.ACCESS_DENIED)
    }
}
