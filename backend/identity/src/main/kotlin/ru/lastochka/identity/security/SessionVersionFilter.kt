package ru.lastochka.identity.security

import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import java.time.Clock
import java.time.Instant
import org.springframework.security.core.context.SecurityContextHolder
import org.springframework.web.filter.OncePerRequestFilter
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.ApiErrorFactory
import ru.lastochka.identity.service.AccountService
import tools.jackson.databind.json.JsonMapper

/** Checks current admission before any protected handler, including auth/WebAuthn. */
class SessionVersionFilter(
    private val accounts: AccountService,
    private val generation: String,
    private val clock: Clock,
    private val json: JsonMapper,
    private val errors: ApiErrorFactory,
) : OncePerRequestFilter() {
    override fun doFilterInternal(
        req: HttpServletRequest,
        res: HttpServletResponse,
        chain: FilterChain,
    ) {
        val path = req.requestURI.removePrefix(req.contextPath)
        if (path.startsWith("/api/v1/auth/") || path.startsWith("/api/v1/admin/"))
            res.setHeader("Cache-Control", "no-store")
        val auth = SecurityContextHolder.getContext().authentication
        if (auth != null && auth.name != Metadata.Identity.ANONYMOUS_PRINCIPAL) {
            val session = req.getSession(false)
            val stored =
                (session?.getAttribute(Metadata.Identity.AUTH_VERSION_ATTRIBUTE) as? Number)
                    ?.toLong()
            val current =
                accounts.find(auth.name)?.takeIf {
                    it.adminEnabled && it.role == Metadata.Identity.ADMIN
                }
            val started =
                (session?.getAttribute(Metadata.PasswordLifecycle.STARTED_AT) as? String)?.let {
                    runCatching { Instant.parse(it) }.getOrNull()
                }
            val temporaryExpired =
                current?.mustChangePassword == true &&
                    (started == null ||
                        !started
                            .plusSeconds(Metadata.PasswordLifecycle.SESSION_SECONDS)
                            .isAfter(clock.instant()) ||
                        current.temporaryPasswordExpiresAt?.isAfter(clock.instant()) != true)
            if (
                stored == null ||
                    stored != current?.authVersion ||
                    session?.getAttribute(Metadata.Concept.GENERATION_ATTRIBUTE) != generation ||
                    temporaryExpired
            ) {
                session?.invalidate()
                SecurityContextHolder.clearContext()
            } else if (current.mustChangePassword) {
                val allowed =
                    path in
                        setOf(
                            "/api/v1/auth/me",
                            "/api/v1/auth/csrf",
                            Metadata.PasswordLifecycle.CHANGE,
                            "/api/v1/auth/logout",
                        )
                val public =
                    path.startsWith(Metadata.Routes.API_V1_PUBLIC) ||
                        (req.method == Metadata.Identity.GET &&
                            (path == Metadata.Routes.API_V1_SESSIONS ||
                                path.startsWith(Metadata.Routes.API_V1_SESSIONS + "/"))) ||
                        path == Metadata.Concept.PUBLIC_ENQUIRIES ||
                        !path.startsWith("/api/")
                if (!allowed && !public) {
                    res.status = Metadata.Http.FORBIDDEN
                    res.contentType = Metadata.Protocol.PROBLEM_JSON
                    json.writeValue(
                        res.outputStream,
                        errors.body(res.status, Metadata.PasswordLifecycle.REQUIRED),
                    )
                    return
                }
            }
        }
        chain.doFilter(req, res)
    }
}
