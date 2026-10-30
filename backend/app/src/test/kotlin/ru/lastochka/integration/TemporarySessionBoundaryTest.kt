package ru.lastochka.integration

import java.time.*
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.Mockito.*
import org.springframework.context.support.StaticMessageSource
import org.springframework.mock.web.*
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken
import org.springframework.security.core.context.SecurityContextHolder
import ru.lastochka.common.Metadata
import ru.lastochka.common.error.*
import ru.lastochka.identity.entity.Account
import ru.lastochka.identity.security.SessionVersionFilter
import ru.lastochka.identity.service.AccountService
import tools.jackson.databind.json.JsonMapper

class TemporarySessionBoundaryTest {
    private val now = Instant.parse("2026-10-26T12:00:00Z")

    @AfterEach
    fun clear() {
        SecurityContextHolder.clearContext()
    }

    private fun check(age: Long, expires: Instant, path: String): Pair<Int, Boolean> {
        val a =
            Account(
                email = "fixture",
                name = "Fixture",
                passwordHash = "unavailable",
                role = "ADMIN",
                login = "fixture",
                adminEnabled = true,
                mustChangePassword = true,
                temporaryPasswordExpiresAt = expires,
            )
        val accounts = mock(AccountService::class.java)
        `when`(accounts.find("fixture")).thenReturn(a)
        val source = StaticMessageSource()
        source.addMessage(
            "PASSWORD_CHANGE_REQUIRED",
            java.util.Locale.forLanguageTag("ru"),
            "Сначала смените временный пароль.",
        )
        source.addMessage("ERROR_TITLE", java.util.Locale.forLanguageTag("ru"), "Ошибка")
        val errors = ApiErrorFactory(MessageProvider(source), 60)
        val filter =
            SessionVersionFilter(
                accounts,
                "generation",
                Clock.fixed(now, ZoneOffset.UTC),
                JsonMapper.builder().build(),
                errors,
            )
        val req = MockHttpServletRequest("GET", "/lastochka$path")
        req.contextPath = "/lastochka"
        req.session.setAttribute(Metadata.Identity.AUTH_VERSION_ATTRIBUTE, 0L)
        req.session.setAttribute(Metadata.Concept.GENERATION_ATTRIBUTE, "generation")
        req.session.setAttribute(
            Metadata.PasswordLifecycle.STARTED_AT,
            now.minusSeconds(age).toString(),
        )
        SecurityContextHolder.getContext().authentication =
            UsernamePasswordAuthenticationToken.authenticated("fixture", null, emptyList())
        val response = MockHttpServletResponse()
        filter.doFilter(
            req,
            response,
            jakarta.servlet.FilterChain { _, res ->
                (res as jakarta.servlet.http.HttpServletResponse).status = 202
            },
        )
        return response.status to (SecurityContextHolder.getContext().authentication != null)
    }

    @Test
    fun `absolute session limit is inclusive and cannot slide`() {
        assertEquals(202 to true, check(899, now.plusSeconds(1), Metadata.PasswordLifecycle.CHANGE))
        assertEquals(
            202 to false,
            check(900, now.plusSeconds(3600), Metadata.PasswordLifecycle.CHANGE),
        )
        assertEquals(202 to false, check(1, now, Metadata.PasswordLifecycle.CHANGE))
    }

    @Test
    fun `public route remains public and webauthn never bypasses password change`() {
        assertEquals(202 to true, check(1, now.plusSeconds(10), "/api/v1/public/landing"))
        assertEquals(
            403 to true,
            check(1, now.plusSeconds(10), "/api/v1/auth/webauthn/credentials"),
        )
        assertEquals(403 to true, check(1, now.plusSeconds(10), "/api/v1/admin/users"))
        for (path in
            listOf(
                "/api/v1/admin/schedule-groups",
                "/api/v1/admin/session-series",
                "/api/v1/admin/session-series/calendar",
            )) {
            assertEquals(403 to true, check(1, now.plusSeconds(10), path))
        }
    }
}
